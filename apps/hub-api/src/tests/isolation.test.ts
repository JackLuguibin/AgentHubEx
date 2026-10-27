import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, users } from "@agenthub/db";
import { eq, sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { createApp } from "../app.js";
import { tapAudit } from "../lib/audit.js";
import { usageDayKey } from "../lib/token-quota.js";

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

describe("P1-08 isolation and acceptance gates", () => {
  const db = createDb(DATABASE_URL);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const { app } = createApp({
    db,
    redis,
    envOverrides: { RUNTIME_MOCK: true },
  });

  beforeAll(async () => {
    await truncateAll(db);
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function json(path: string, init: RequestInit & { token?: string } = {}) {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("content-type", "application/json");
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    const res = await app.request(path, { ...init, headers });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    return { res, body };
  }

  async function register(email: string, handle: string, displayName: string) {
    const res = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email,
        password: "password-isolation-1",
        displayName,
        handle,
      }),
    });
    expect(res.res.status).toBe(201);
    return res.body.user.id as string;
  }

  async function login(email: string) {
    const res = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "password-isolation-1" }),
    });
    expect(res.res.status).toBe(200);
    return res.body.accessToken as string;
  }

  async function asAdmin() {
    const email = "iso-admin@example.com";
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length === 0) {
      await register(email, "isoadmin", "Iso Admin");
      await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.email, email));
    }
    return login(email);
  }

  async function tenantProject(admin: string, slug: string, key: string) {
    const tenant = await json("/v1/admin/tenants", {
      method: "POST",
      token: admin,
      body: JSON.stringify({ slug, name: slug, ownerEmail: "iso-admin@example.com" }),
    });
    expect(tenant.res.status).toBe(201);
    const project = await json(`/v1/tenants/${tenant.body.id}/projects`, {
      method: "POST",
      token: admin,
      body: JSON.stringify({ key, name: key }),
    });
    expect(project.res.status).toBe(201);
    return { tenantId: tenant.body.id as string, projectId: project.body.id as string };
  }

  async function addDeveloper(admin: string, tenantId: string, projectId: string, email: string) {
    const member = await json(`/v1/projects/${projectId}/members`, {
      method: "POST",
      token: admin,
      body: JSON.stringify({ email, role: "developer" }),
    });
    expect(member.res.status).toBe(201);
    return member.body.userId as string;
  }

  async function openSession(token: string, projectId: string, title: string) {
    const cred = await json("/v1/me/credentials", {
      method: "POST",
      token,
      body: JSON.stringify({ provider: "opencode", label: title, secret: `sk-${title}` }),
    });
    expect(cred.res.status).toBe(201);
    const session = await json(`/v1/projects/${projectId}/sessions`, {
      method: "POST",
      token,
      body: JSON.stringify({ title }),
    });
    expect(session.res.status).toBe(201);
    return session.body as { id: string; workspaceId: string; status: string };
  }

  async function hidden(token: string, sessionId: string, workspaceId: string) {
    const session = await json(`/v1/sessions/${sessionId}`, { token });
    const workspace = await json(`/v1/workspaces/${workspaceId}/sync-config`, {
      method: "POST",
      token,
    });
    const agent = await json(`/v1/workspaces/${workspaceId}/agent/file?path=/`, { token });
    expect(session.res.status).toBe(404);
    expect(workspace.res.status).toBe(404);
    expect(agent.res.status).toBe(404);
    expect(session.body.error.code).toBe("NOT_FOUND");
  }

  it("hides session, workspace, and agent proxy across user, tenant, and non-member", async () => {
    const admin = await asAdmin();
    const { tenantId, projectId } = await tenantProject(admin, "iso-a", "ISOA");
    await tenantProject(admin, "iso-b", "ISOB");
    await register("iso-bob@example.com", "isobob", "Bob");
    await register("iso-eve@example.com", "isoeve", "Eve");
    await register("iso-carol@example.com", "isocarol", "Carol");
    await register("iso-dave@example.com", "isodave", "Dave");
    await addDeveloper(admin, tenantId, projectId, "iso-bob@example.com");
    await addDeveloper(admin, tenantId, projectId, "iso-eve@example.com");
    const carolTenant = await json("/v1/admin/tenants", {
      method: "GET",
      token: admin,
    });
    const tenantB = (carolTenant.body.items as Array<{ id: string; slug: string }>).find(
      (item) => item.slug === "iso-b",
    )!;
    const carol = await json(`/v1/tenants/${tenantB.id}/members`, {
      method: "POST",
      token: admin,
      body: JSON.stringify({ email: "iso-carol@example.com", role: "member" }),
    });
    expect(carol.res.status).toBe(201);

    const bob = await login("iso-bob@example.com");
    const eve = await login("iso-eve@example.com");
    const cross = await login("iso-carol@example.com");
    const outsider = await login("iso-dave@example.com");
    const session = await openSession(bob, projectId, "bob-room");

    const owner = await json(`/v1/sessions/${session.id}`, { token: bob });
    expect(owner.res.status).toBe(200);
    const ownAgent = await json(`/v1/workspaces/${session.workspaceId}/agent/file?path=/`, {
      token: bob,
    });
    expect(ownAgent.res.status).toBe(200);

    const denied: Array<{ action: string; actorId: string; targetId?: string | null }> = [];
    const stop = tapAudit((entry) => {
      if (entry.action === "access.denied") denied.push(entry);
    });
    try {
      await hidden(eve, session.id, session.workspaceId);
      await hidden(cross, session.id, session.workspaceId);
      await hidden(outsider, session.id, session.workspaceId);
    } finally {
      stop();
    }

    const listed = await json(`/v1/projects/${projectId}/sessions`, { token: eve });
    expect(listed.res.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(session.id);

    const carolId = carol.body.userId as string;
    expect(
      denied.some(
        (entry) =>
          entry.actorId === carolId &&
          entry.targetId === session.id,
      ),
    ).toBe(true);
  });

  it("aborts sessions when a tenant is suspended, a project is archived, or a member is removed", async () => {
    const admin = await asAdmin();
    const home = await tenantProject(admin, "life-a", "LIFA");
    const other = await tenantProject(admin, "life-b", "LIFB");
    await register("life-bob@example.com", "lifebob", "Life Bob");
    await register("life-eve@example.com", "lifeeve", "Life Eve");
    const bobId = await addDeveloper(admin, home.tenantId, home.projectId, "life-bob@example.com");
    await addDeveloper(admin, other.tenantId, other.projectId, "life-bob@example.com");
    const eveId = await addDeveloper(admin, home.tenantId, home.projectId, "life-eve@example.com");
    const bob = await login("life-bob@example.com");
    const eve = await login("life-eve@example.com");
    const live = await openSession(bob, home.projectId, "live-room");
    const eveSession = await openSession(eve, home.projectId, "eve-room");

    const members = await json(`/v1/projects/${home.projectId}/members`, { token: admin });
    const owner = (members.body.items as Array<{ userId: string; role: string }>).find(
      (item) => item.role === "owner",
    )!;
    const keepOwner = await json(`/v1/projects/${home.projectId}/members/${owner.userId}`, {
      method: "DELETE",
      token: admin,
    });
    expect(keepOwner.res.status).toBe(409);

    const removed = await json(`/v1/projects/${home.projectId}/members/${eveId}`, {
      method: "DELETE",
      token: admin,
    });
    expect(removed.res.status).toBe(204);
    const eveAfter = await json(`/v1/sessions/${eveSession.id}`, { token: admin });
    expect(eveAfter.res.status).toBe(200);
    expect(eveAfter.body.status).toBe("aborted");
    expect(eveAfter.body.statusReason).toBe("member_removed");
    const eveLocked = await json(`/v1/workspaces/${eveSession.workspaceId}/agent/file?path=/`, {
      token: eve,
    });
    expect(eveLocked.res.status).toBe(404);

    const archived = await json(`/v1/projects/${home.projectId}/archive`, {
      method: "POST",
      token: admin,
    });
    expect(archived.res.status).toBe(200);
    const afterArchive = await json(`/v1/sessions/${live.id}`, { token: admin });
    expect(afterArchive.body.status).toBe("aborted");
    expect(afterArchive.body.statusReason).toBe("project_archived");
    const archivedSend = await json(`/v1/sessions/${live.id}/messages`, {
      method: "POST",
      token: bob,
      body: JSON.stringify({ parts: [{ type: "text", text: "still there?" }] }),
    });
    expect(archivedSend.res.status).toBe(409);
    expect(archivedSend.body.error.code).toBe("PROJECT_ARCHIVED");
    const archivedCreate = await json(`/v1/projects/${home.projectId}/sessions`, {
      method: "POST",
      token: bob,
      body: JSON.stringify({ title: "too late" }),
    });
    expect(archivedCreate.res.status).toBe(409);
    expect(archivedCreate.body.error.code).toBe("PROJECT_ARCHIVED");

    const elsewhere = await openSession(bob, other.projectId, "other-room");
    const suspended = await json(`/v1/admin/tenants/${other.tenantId}/suspend`, {
      method: "POST",
      token: admin,
    });
    expect(suspended.res.status).toBe(200);
    const afterSuspend = await json(`/v1/sessions/${elsewhere.id}`, { token: admin });
    expect(afterSuspend.body.status).toBe("aborted");
    expect(afterSuspend.body.statusReason).toBe("tenant_suspended");
    const blocked = await json(`/v1/projects/${other.projectId}/sessions`, {
      method: "POST",
      token: bob,
      body: JSON.stringify({ title: "nope" }),
    });
    expect(blocked.res.status).toBe(409);
    expect(blocked.body.error.code).toBe("TENANT_SUSPENDED");
    const blockedMessage = await json(`/v1/sessions/${elsewhere.id}/messages`, {
      method: "POST",
      token: bob,
      body: JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
    });
    expect(blockedMessage.res.status).toBe(409);
    expect(blockedMessage.body.error.code).toBe("TENANT_SUSPENDED");

    const switched = await json("/v1/auth/switch-tenant", {
      method: "POST",
      token: bob,
      body: JSON.stringify({ tenantId: home.tenantId }),
    });
    expect(switched.res.status).toBe(200);
    expect(bobId).toBeTruthy();
  });

  it("never returns credential secrets and rejects provider hosts outside the project allowlist", async () => {
    const admin = await asAdmin();
    const { projectId } = await tenantProject(admin, "cred-a", "CREDA");
    const secret = "sk-isolation-secret-77";
    const created = await json("/v1/me/credentials", {
      method: "POST",
      token: admin,
      body: JSON.stringify({
        provider: "openai",
        label: "personal",
        secret,
        metadata: { baseUrl: "https://api.openai.com/v1" },
      }),
    });
    expect(created.res.status).toBe(201);
    const listed = await json("/v1/me/credentials", { token: admin });
    const encoded = JSON.stringify(listed.body);
    expect(encoded).not.toContain(secret);
    expect(encoded).not.toContain("secretCiphertext");
    const personal = (listed.body.items as Array<{ label: string; last4: string }>).find(
      (item) => item.label === "personal",
    );
    expect(personal?.last4).toBe("t-77");

    const patched = await json(`/v1/projects/${projectId}`, {
      method: "PATCH",
      token: admin,
      body: JSON.stringify({
        settings: { allowedProviderHosts: ["llm.internal.example", "*.corp.local"] },
      }),
    });
    expect(patched.res.status).toBe(200);

    const blocked = await json(`/v1/projects/${projectId}/credentials`, {
      method: "POST",
      token: admin,
      body: JSON.stringify({
        provider: "openai",
        label: "public",
        secret: "proj-secret-public",
        metadata: { baseUrl: "https://api.openai.com/v1" },
      }),
    });
    expect(blocked.res.status).toBe(400);
    expect(blocked.body.error.code).toBe("VALIDATION_FAILED");

    const allowed = await json(`/v1/projects/${projectId}/credentials`, {
      method: "POST",
      token: admin,
      body: JSON.stringify({
        provider: "openai",
        label: "internal",
        secret: "proj-secret-internal",
        isDefault: true,
        metadata: { baseUrl: "https://gateway.corp.local/v1" },
      }),
    });
    expect(allowed.res.status).toBe(201);
    const projectList = await json(`/v1/projects/${projectId}/credentials`, { token: admin });
    expect(JSON.stringify(projectList.body)).not.toContain("proj-secret-internal");

    const session = await json(`/v1/projects/${projectId}/sessions`, {
      method: "POST",
      token: admin,
      body: JSON.stringify({
        title: "host-gate",
        credentialSource: "user",
        credentialId: created.body.id,
      }),
    });
    expect(session.res.status).toBe(400);
    expect(session.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects new sessions and messages after the daily token quota, without aborting the open one", async () => {
    const admin = await asAdmin();
    const { tenantId, projectId } = await tenantProject(admin, "quota-a", "QUOTA");
    const session = await openSession(admin, projectId, "quota-room");
    expect(session.status).toBe("active");

    const patched = await json(`/v1/tenants/${tenantId}`, {
      method: "PATCH",
      token: admin,
      body: JSON.stringify({ quota: { tokensPerDay: 5 } }),
    });
    expect(patched.res.status).toBe(200);
    await redis.set(usageDayKey(tenantId), "5");

    const message = await json(`/v1/sessions/${session.id}/messages`, {
      method: "POST",
      token: admin,
      body: JSON.stringify({ parts: [{ type: "text", text: "more" }] }),
    });
    expect(message.res.status).toBe(429);
    expect(message.body.error.code).toBe("QUOTA_EXCEEDED");
    expect(message.body.error.details.quota).toBe("tokensPerDay");

    const still = await json(`/v1/sessions/${session.id}`, { token: admin });
    expect(still.body.status).toBe("active");

    const again = await json(`/v1/projects/${projectId}/sessions`, {
      method: "POST",
      token: admin,
      body: JSON.stringify({ title: "over quota" }),
    });
    expect(again.res.status).toBe(429);
    expect(again.body.error.code).toBe("QUOTA_EXCEEDED");
  });

  it("closes the event stream when Last-Event-ID is no longer in the buffer", async () => {
    const admin = await asAdmin();
    const { projectId } = await tenantProject(admin, "sse-a", "SSEA");
    const session = await openSession(admin, projectId, "sse-room");
    const streamKey = `sess:${session.id}:events`;
    await redis.xadd(streamKey, "*", "seq", "1", "data", JSON.stringify({ seq: 1 }));
    await redis.xadd(streamKey, "*", "seq", "2", "data", JSON.stringify({ seq: 2 }));

    const stale = await app.request(`/v1/sessions/${session.id}/events`, {
      headers: {
        authorization: `Bearer ${admin}`,
        "Last-Event-ID": "50",
      },
    });
    expect(stale.status).toBe(200);
    const staleText = await stale.text();
    expect(staleText).toContain("SSE_CURSOR_STALE");

    const ac = new AbortController();
    const live = await app.request(`/v1/sessions/${session.id}/events`, {
      headers: {
        authorization: `Bearer ${admin}`,
        "Last-Event-ID": "1",
      },
      signal: ac.signal,
    });
    expect(live.status).toBe(200);
    const reader = live.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !buf.includes("id: 2")) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    ac.abort();
    expect(buf).toContain("id: 2");
    expect(buf).not.toContain("SSE_CURSOR_STALE");
  });
});
