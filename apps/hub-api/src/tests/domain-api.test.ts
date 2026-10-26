import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@agenthub/db";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { createApp } from "../app.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://agenthub:agenthub@localhost:5432/agenthub";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

async function truncateAll(db: ReturnType<typeof createDb>) {
  await db.execute(sql.raw(`
    TRUNCATE TABLE
      agent_sessions,
      workspaces,
      project_issues,
      project_runtime_bindings,
      runtime_instances,
      credential_versions,
      project_credentials,
      user_credentials,
      hub_api_keys,
      project_memberships,
      projects,
      tenant_memberships,
      tenants,
      users
    RESTART IDENTITY CASCADE
  `));
}

describe("P0-02 domain API", () => {
  const db = createDb(DATABASE_URL);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const { app } = createApp({ db, redis });

  beforeAll(async () => {
    await truncateAll(db);
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function json(
    path: string,
    init: RequestInit & { token?: string } = {},
  ) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    const res = await app.request(path, { ...init, headers });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    return { res, body };
  }

  it("registers, logs in, refreshes, and returns /v1/me", async () => {
    const register = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "alice@example.com",
        password: "password-alice-1",
        displayName: "Alice",
        handle: "alice",
      }),
    });
    expect(register.res.status).toBe(201);
    expect(register.body.accessToken).toBeTruthy();
    expect(register.body.user.email).toBe("alice@example.com");

    const me = await json("/v1/me", { token: register.body.accessToken });
    expect(me.res.status).toBe(200);
    expect(me.body.handle).toBe("alice");

    const login = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "alice@example.com",
        password: "password-alice-1",
      }),
    });
    expect(login.res.status).toBe(200);

    const setCookie = login.res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ah_refresh=");

    const refresh = await app.request("/v1/auth/refresh", {
      method: "POST",
      headers: { cookie: setCookie.split(";")[0]! },
    });
    expect(refresh.status).toBe(200);
    const refreshBody = (await refresh.json()) as { accessToken: string };
    expect(refreshBody.accessToken).toBeTruthy();
  });

  it("enforces cascade unbind and last-owner protection", async () => {
    // promote alice to platform admin via db for tenant create
    await db.execute(sql`UPDATE users SET is_platform_admin = true WHERE email = 'alice@example.com'`);

    const login = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "alice@example.com",
        password: "password-alice-1",
      }),
    });
    const adminToken = login.body.accessToken as string;

    const tenant = await json("/v1/admin/tenants", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        slug: "cascade-co",
        name: "Cascade Co",
        ownerEmail: "alice@example.com",
      }),
    });
    expect(tenant.res.status).toBe(201);
    const tenantId = tenant.body.id as string;

    const bob = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "bob@example.com",
        password: "password-bob-12",
        displayName: "Bob",
        handle: "bob",
      }),
    });
    expect(bob.res.status).toBe(201);

    const addMember = await json(`/v1/tenants/${tenantId}/members`, {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ email: "bob@example.com", role: "member" }),
    });
    expect(addMember.res.status).toBe(201);

    // email reuse: adding same email again conflicts
    const reuse = await json(`/v1/tenants/${tenantId}/members`, {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ email: "bob@example.com", role: "member" }),
    });
    expect(reuse.res.status).toBe(409);

    const project = await json(`/v1/tenants/${tenantId}/projects`, {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ key: "APP", name: "App" }),
    });
    expect(project.res.status).toBe(201);
    const projectId = project.body.id as string;

    const bindBob = await json(`/v1/projects/${projectId}/members`, {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ email: "bob@example.com", role: "developer" }),
    });
    expect(bindBob.res.status).toBe(201);

    const membersBefore = await json(`/v1/projects/${projectId}/members`, {
      token: adminToken,
    });
    expect(membersBefore.body.items.length).toBe(2);

    // remove tenant membership → cascades project membership
    const remove = await json(`/v1/tenants/${tenantId}/members/${addMember.body.userId}`, {
      method: "DELETE",
      token: adminToken,
    });
    expect(remove.res.status).toBe(204);

    const membersAfter = await json(`/v1/projects/${projectId}/members`, {
      token: adminToken,
    });
    expect(membersAfter.body.items.length).toBe(1);
    expect(membersAfter.body.items[0].email).toBe("alice@example.com");

    // cannot remove last tenant owner
    const lastOwner = await json(`/v1/tenants/${tenantId}/members/${login.body.user.id}`, {
      method: "DELETE",
      token: adminToken,
    });
    expect(lastOwner.res.status).toBe(409);
    expect(lastOwner.body.error.code).toBe("CONFLICT");

    // cannot remove last project owner
    const lastProjectOwner = await json(
      `/v1/projects/${projectId}/members/${login.body.user.id}`,
      { method: "DELETE", token: adminToken },
    );
    expect(lastProjectOwner.res.status).toBe(409);
  });

  it("supports suspend/archive and issue/credential/instance CRUD without leaking secrets", async () => {
    const login = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "alice@example.com",
        password: "password-alice-1",
      }),
    });
    const token = login.body.accessToken as string;

    const tenantCreate = await json("/v1/admin/tenants", {
      method: "POST",
      token,
      body: JSON.stringify({
        slug: "life-co",
        name: "Life Co",
        ownerEmail: "alice@example.com",
      }),
    });
    const tenantId = tenantCreate.body.id as string;

    const project = await json(`/v1/tenants/${tenantId}/projects`, {
      method: "POST",
      token,
      body: JSON.stringify({ key: "LIFE", name: "Lifecycle" }),
    });
    const projectId = project.body.id as string;

    const cred = await json("/v1/me/credentials", {
      method: "POST",
      token,
      body: JSON.stringify({
        provider: "anthropic",
        label: "personal",
        secret: "sk-test-secret-value",
      }),
    });
    expect(cred.res.status).toBe(201);
    expect(cred.body.last4).toBe("alue");
    expect(JSON.stringify(cred.body)).not.toContain("sk-test-secret-value");

    const pcred = await json(`/v1/projects/${projectId}/credentials`, {
      method: "POST",
      token,
      body: JSON.stringify({
        provider: "openai",
        label: "shared",
        secret: "proj-secret-9999",
        isDefault: true,
      }),
    });
    expect(pcred.res.status).toBe(201);
    expect(JSON.stringify(pcred.body)).not.toContain("proj-secret-9999");

    const instance = await json(`/v1/tenants/${tenantId}/instances`, {
      method: "POST",
      token,
      body: JSON.stringify({
        name: "oc-1",
        runtimeType: "opencode",
        baseUrl: "http://127.0.0.1:4096",
        isolation: "dedicated",
      }),
    });
    expect(instance.res.status).toBe(201);
    expect(instance.body.mode).toBe("external");

    const issue = await json(`/v1/projects/${projectId}/issues`, {
      method: "POST",
      token,
      body: JSON.stringify({ title: "First card", status: "todo" }),
    });
    expect(issue.res.status).toBe(201);
    expect(issue.body.key).toBe("LIFE-1");

    const moved = await json(`/v1/issues/${issue.body.id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(moved.res.status).toBe(200);
    expect(moved.body.status).toBe("in_progress");

    const archived = await json(`/v1/projects/${projectId}/archive`, {
      method: "POST",
      token,
    });
    expect(archived.res.status).toBe(200);
    expect(archived.body.archivedAt).toBeTruthy();

    const suspended = await json(`/v1/admin/tenants/${tenantId}/suspend`, {
      method: "POST",
      token,
    });
    expect(suspended.res.status).toBe(200);
    expect(suspended.body.status).toBe("suspended");
  });

  it("exposes OpenAPI document", async () => {
    const res = await app.request("/v1/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toMatch(/^3/);
    expect(doc.paths["/auth/login"]).toBeTruthy();
  });

  it("rejects invalid login/register payloads via zod", async () => {
    const bad = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-email", password: "short" }),
    });
    expect(bad.res.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_FAILED");
  });
});
