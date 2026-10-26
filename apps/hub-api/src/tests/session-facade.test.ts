import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, users } from "@agenthub/db";
import { eq, sql } from "drizzle-orm";
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

describe("P0-03 session facade", () => {
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
    headers.set("content-type", "application/json");
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    const res = await app.request(path, { ...init, headers });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    return { res, body };
  }

  it("creates session, sends message, streams mock SSE deltas", async () => {
    const reg = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "streamer@example.com",
        password: "password-streamer-1",
        displayName: "Streamer",
        handle: "streamer",
      }),
    });
    expect(reg.res.status).toBe(201);

    await db
      .update(users)
      .set({ isPlatformAdmin: true })
      .where(eq(users.email, "streamer@example.com"));

    const login = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "streamer@example.com",
        password: "password-streamer-1",
      }),
    });
    expect(login.res.status).toBe(200);
    let tok = login.body.accessToken as string;

    const t = await json("/v1/admin/tenants", {
      method: "POST",
      token: tok,
      body: JSON.stringify({
        slug: "stream-co",
        name: "Stream Co",
        ownerEmail: "streamer@example.com",
      }),
    });
    expect(t.res.status).toBe(201);
    const tid = t.body.id as string;

    const switched = await json("/v1/auth/switch-tenant", {
      method: "POST",
      token: tok,
      body: JSON.stringify({ tenantId: tid }),
    });
    expect(switched.res.status).toBe(200);
    tok = switched.body.accessToken as string;

    const project = await json(`/v1/tenants/${tid}/projects`, {
      method: "POST",
      token: tok,
      body: JSON.stringify({ key: "STR", name: "Stream Project" }),
    });
    expect(project.res.status).toBe(201);
    const projectId = project.body.id as string;

    const cred = await json("/v1/me/credentials", {
      method: "POST",
      token: tok,
      body: JSON.stringify({
        provider: "opencode",
        label: "mock",
        secret: "sk-test-mock",
      }),
    });
    expect(cred.res.status).toBe(201);

    const session = await json(`/v1/projects/${projectId}/sessions`, {
      method: "POST",
      token: tok,
      body: JSON.stringify({ title: "SSE demo" }),
    });
    expect(session.res.status).toBe(201);
    const sessionId = session.body.id as string;

    // Open SSE before sending so mock bus subscribers receive deltas
    const ac = new AbortController();
    const eventsPromise = (async () => {
      const res = await app.request(`/v1/sessions/${sessionId}/events`, {
        headers: { authorization: `Bearer ${tok}` },
        signal: ac.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes("assistant.delta")) return true;
      }
      return false;
    })();

    // Give the SSE loop a tick to subscribe
    await new Promise((r) => setTimeout(r, 100));

    const msg = await json(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      token: tok,
      body: JSON.stringify({ parts: [{ type: "text", text: "hello facade" }] }),
    });
    expect(msg.res.status).toBe(202);

    const sawDelta = await eventsPromise;
    ac.abort();
    expect(sawDelta).toBe(true);
  });
});
