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

describe("P1-02 membership bindings", () => {
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

  it("reuses invite email, binds multi-tenant/multi-project, cascades unbind, refuses last owner", async () => {
    const register = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "owner@example.com",
        password: "password-owner-1",
        displayName: "Owner",
        handle: "owner",
      }),
    });
    expect(register.res.status).toBe(201);
    const ownerId = register.body.user.id as string;

    await db.execute(
      sql`UPDATE users SET is_platform_admin = true WHERE id = ${ownerId}`,
    );

    const login = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "owner@example.com",
        password: "password-owner-1",
      }),
    });
    expect(login.res.status).toBe(200);
    const adminToken = login.body.accessToken as string;

    const t1 = await json("/v1/admin/tenants", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        slug: "bind-a",
        name: "Bind A",
        ownerEmail: "owner@example.com",
      }),
    });
    const t2 = await json("/v1/admin/tenants", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        slug: "bind-b",
        name: "Bind B",
        ownerEmail: "owner@example.com",
      }),
    });
    expect(t1.res.status).toBe(201);
    expect(t2.res.status).toBe(201);
    const tenantA = t1.body.id as string;
    const tenantB = t2.body.id as string;

    const p1 = await json(`/v1/tenants/${tenantA}/projects`, {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ key: "PA", name: "Project A" }),
    });
    const p2 = await json(`/v1/tenants/${tenantB}/projects`, {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ key: "PB", name: "Project B" }),
    });
    expect(p1.res.status).toBe(201);
    expect(p2.res.status).toBe(201);
    const projectA = p1.body.id as string;
    const projectB = p2.body.id as string;

    const member = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "member@example.com",
        password: "password-member1",
        displayName: "Member",
        handle: "member",
      }),
    });
    expect(member.res.status).toBe(201);
    const memberId = member.body.user.id as string;

    const invite = await json(`/v1/tenants/${tenantA}/invitations`, {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        email: "member@example.com",
        tenantRole: "member",
        projectGrants: [{ projectId: projectA, role: "developer" }],
      }),
    });
    expect(invite.res.status).toBe(201);
    expect(invite.body.reusedExistingUser).toBe(true);
    expect(invite.body.userId).toBe(memberId);

    const inviteAgain = await json(`/v1/tenants/${tenantA}/invitations`, {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        email: "member@example.com",
        tenantRole: "member",
      }),
    });
    expect(inviteAgain.res.status).toBe(409);

    const put = await json(`/v1/users/${memberId}/bindings`, {
      method: "PUT",
      token: adminToken,
      body: JSON.stringify({
        tenants: [
          {
            tenantId: tenantA,
            role: "member",
            projects: [{ projectId: projectA, role: "developer" }],
          },
          {
            tenantId: tenantB,
            role: "admin",
            projects: [{ projectId: projectB, role: "viewer" }],
          },
        ],
      }),
    });
    expect(put.res.status).toBe(200);
    expect(put.body.tenants).toHaveLength(2);
    expect(put.body.projects).toHaveLength(2);

    const directory = await json(`/v1/directory/users?tenantId=${tenantA}`, {
      token: adminToken,
    });
    expect(directory.res.status).toBe(200);
    expect(
      directory.body.items.some((u: { userId: string }) => u.userId === memberId),
    ).toBe(true);

    const unbind = await json(`/v1/users/${memberId}/bindings`, {
      method: "PUT",
      token: adminToken,
      body: JSON.stringify({
        tenants: [
          {
            tenantId: tenantB,
            role: "admin",
            projects: [{ projectId: projectB, role: "owner" }],
          },
        ],
      }),
    });
    expect(unbind.res.status).toBe(200);
    expect(unbind.body.tenants.map((t: { tenantId: string }) => t.tenantId)).toEqual([
      tenantB,
    ]);
    expect(unbind.body.projects).toHaveLength(1);
    expect(unbind.body.projects[0].projectId).toBe(projectB);

    // projectA no longer lists member (cascade from tenant unbind)
    const projectAMembers = await json(`/v1/projects/${projectA}/members`, {
      token: adminToken,
    });
    expect(
      projectAMembers.body.items.some((m: { userId: string }) => m.userId === memberId),
    ).toBe(false);

    // make member the sole project owner, then refuse clearing that binding
    const removeOwner = await json(`/v1/projects/${projectB}/members/${ownerId}`, {
      method: "DELETE",
      token: adminToken,
    });
    expect(removeOwner.res.status).toBe(204);

    const refuse = await json(`/v1/users/${memberId}/bindings`, {
      method: "PUT",
      token: adminToken,
      body: JSON.stringify({
        tenants: [{ tenantId: tenantB, role: "admin", projects: [] }],
      }),
    });
    expect(refuse.res.status).toBe(409);
    expect(refuse.body.error.code).toBe("CONFLICT");
    expect(String(refuse.body.error.message)).toMatch(/last project owner/i);

    // refuse removing last tenant owner
    const refuseTenant = await json(`/v1/tenants/${tenantA}/members/${ownerId}`, {
      method: "DELETE",
      token: adminToken,
    });
    expect(refuseTenant.res.status).toBe(409);
    expect(refuseTenant.body.error.code).toBe("CONFLICT");
  });
});
