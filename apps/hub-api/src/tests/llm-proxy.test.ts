import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, users } from "@agenthub/db";
import { eq, sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { createApp } from "../app.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://agenthub:agenthub@localhost:5432/agenthub";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const USER_KEY = "sk-user-provider-key-do-not-leak";
const PROJECT_KEY = "sk-project-provider-key-do-not-leak";

async function truncateAll(db: ReturnType<typeof createDb>) {
  await db.execute(sql.raw(`
    TRUNCATE TABLE
      usage_records,
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

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

type Seen = { method: string; url: string; body: string; apiKey: string | null };

function listen(handler: (req: IncomingMessage, body: string, res: import("node:http").ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    void readBody(req).then((body) => {
      seen.push({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        body,
        apiKey: req.headers["x-api-key"]?.toString() ?? null,
      });
      handler(req, body, res);
    });
  });
  return new Promise<{ server: Server; baseUrl: string; seen: Seen[] }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, seen });
    });
  });
}

describe("P3-02 LLM proxy", () => {
  const db = createDb(DATABASE_URL);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const { app } = createApp({
    db,
    redis,
    envOverrides: { RUNTIME_MOCK: false, PUBLIC_BASE_URL: "http://hub.internal" },
  });
  let runtime: Awaited<ReturnType<typeof listen>>;
  let provider: Awaited<ReturnType<typeof listen>>;

  beforeAll(async () => {
    await truncateAll(db);
    await redis.flushdb();
    runtime = await listen((req, _body, res) => {
      const url = new URL(req.url ?? "/", "http://runtime");
      if (url.pathname === "/global/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ healthy: true }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/session") {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `rt-${runtime.seen.length}` }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    provider = await listen((req, _body, res) => {
      const key = req.headers["x-api-key"]?.toString() ?? "";
      const usage = key === PROJECT_KEY ? { input_tokens: 3, output_tokens: 5 } : { input_tokens: 11, output_tokens: 7 };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "claude-test", usage }));
    });
  });

  afterAll(async () => {
    runtime.server.close();
    provider.server.close();
    await redis.quit();
  });

  async function json(path: string, init: RequestInit & { token?: string } = {}) {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    const res = await app.request(path, { ...init, headers });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    return { res, body, text };
  }

  async function adminToken() {
    const email = "proxy-admin@example.com";
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!existing) {
      const reg = await json("/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email,
          password: "password-proxy-admin-1",
          displayName: "Proxy Admin",
          handle: "proxyadmin",
        }),
      });
      expect(reg.res.status).toBe(201);
      await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.email, email));
    }
    const login = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "password-proxy-admin-1" }),
    });
    expect(login.res.status).toBe(200);
    return login.body.accessToken as string;
  }

  function proxyTokenFromRuntime() {
    const put = [...runtime.seen].reverse().find((entry) => entry.method === "PUT" && entry.url.startsWith("/auth/"));
    expect(put).toBeTruthy();
    const payload = JSON.parse(put!.body) as { key?: string; baseURL?: string };
    return { key: payload.key ?? "", baseURL: payload.baseURL ?? "", raw: put!.body };
  }

  it("keeps the provider key out of the runtime and meters user versus project credentials", async () => {
    const token = await adminToken();
    const tenant = await json("/v1/admin/tenants", {
      method: "POST",
      token,
      body: JSON.stringify({ slug: "proxy-co", name: "Proxy Co", ownerEmail: "proxy-admin@example.com" }),
    });
    expect(tenant.res.status).toBe(201);
    const tenantId = tenant.body.id as string;
    const project = await json(`/v1/tenants/${tenantId}/projects`, {
      method: "POST",
      token,
      body: JSON.stringify({ key: "PRX", name: "Proxy" }),
    });
    const projectId = project.body.id as string;

    const instance = await json(`/v1/tenants/${tenantId}/instances`, {
      method: "POST",
      token,
      body: JSON.stringify({
        name: "oc-proxy",
        runtimeType: "opencode",
        baseUrl: runtime.baseUrl,
        auth: { username: "opencode", password: "node-secret" },
        isolation: "dedicated",
        assignedProjectIds: [projectId],
      }),
    });
    expect(instance.res.status).toBe(201);

    const userCred = await json("/v1/me/credentials", {
      method: "POST",
      token,
      body: JSON.stringify({
        provider: "anthropic",
        label: "personal",
        secret: USER_KEY,
        metadata: { baseUrl: provider.baseUrl },
      }),
    });
    expect(userCred.res.status).toBe(201);
    const projectCred = await json(`/v1/projects/${projectId}/credentials`, {
      method: "POST",
      token,
      body: JSON.stringify({
        provider: "anthropic",
        label: "shared",
        secret: PROJECT_KEY,
        metadata: { baseUrl: provider.baseUrl },
        isDefault: true,
      }),
    });
    expect(projectCred.res.status).toBe(201);

    const userSession = await json(`/v1/projects/${projectId}/sessions`, {
      method: "POST",
      token,
      body: JSON.stringify({
        title: "personal",
        credentialSource: "user",
        credentialId: userCred.body.id,
      }),
    });
    expect(userSession.res.status).toBe(201);
    runtime.seen.length = 0;
    const sent = await json(`/v1/sessions/${userSession.body.id}/messages`, {
      method: "POST",
      token,
      body: JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
    });
    expect(sent.res.status).toBe(202);
    const injected = proxyTokenFromRuntime();
    expect(injected.raw.includes(USER_KEY)).toBe(false);
    expect(injected.raw.includes(provider.baseUrl)).toBe(false);
    expect(injected.baseURL).toBe("http://hub.internal/llm/anthropic");
    expect(injected.key.split(".").length).toBe(3);

    const proxied = await json("/llm/anthropic/v1/messages", {
      method: "POST",
      token: injected.key,
      body: JSON.stringify({ model: "claude-test" }),
    });
    expect(proxied.res.status).toBe(200);
    expect(proxied.text.includes(USER_KEY)).toBe(false);
    expect(provider.seen.at(-1)?.apiKey).toBe(USER_KEY);
    expect(provider.seen.at(-1)?.url).toBe("/v1/messages");

    const projectSession = await json(`/v1/projects/${projectId}/sessions`, {
      method: "POST",
      token,
      body: JSON.stringify({
        title: "shared",
        credentialSource: "project",
        credentialId: projectCred.body.id,
      }),
    });
    expect(projectSession.res.status).toBe(201);
    const sentProject = await json(`/v1/sessions/${projectSession.body.id}/messages`, {
      method: "POST",
      token,
      body: JSON.stringify({ parts: [{ type: "text", text: "hello project" }] }),
    });
    expect(sentProject.res.status).toBe(202);
    const projectInjected = proxyTokenFromRuntime();
    expect(projectInjected.raw.includes(PROJECT_KEY)).toBe(false);
    const projectProxied = await json("/llm/anthropic/v1/messages", {
      method: "POST",
      token: projectInjected.key,
      body: JSON.stringify({ model: "claude-test" }),
    });
    expect(projectProxied.res.status).toBe(200);
    expect(provider.seen.at(-1)?.apiKey).toBe(PROJECT_KEY);

    const usage = await json(`/v1/projects/${projectId}/usage?groupBy=credential`, { token });
    expect(usage.res.status).toBe(200);
    const items = usage.body.items as Array<{
      credentialSource: string;
      credentialId: string;
      userId: string;
      projectId: string;
      inputTokens: number;
      outputTokens: number;
    }>;
    const personal = items.find((item) => item.credentialSource === "user");
    const shared = items.find((item) => item.credentialSource === "project");
    expect(personal).toMatchObject({
      credentialId: userCred.body.id,
      userId: userSession.body.ownerUserId,
      projectId,
      inputTokens: 11,
      outputTokens: 7,
    });
    expect(shared).toMatchObject({
      credentialId: projectCred.body.id,
      projectId,
      inputTokens: 3,
      outputTokens: 5,
    });

    const devReg = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "proxy-dev@example.com",
        password: "password-proxy-dev-1",
        displayName: "Proxy Dev",
        handle: "proxydev",
      }),
    });
    expect(devReg.res.status).toBe(201);
    const added = await json(`/v1/projects/${projectId}/members`, {
      method: "POST",
      token,
      body: JSON.stringify({ email: "proxy-dev@example.com", role: "developer" }),
    });
    expect(added.res.status).toBe(201);
    const devLogin = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "proxy-dev@example.com", password: "password-proxy-dev-1" }),
    });
    const hidden = await json(`/v1/projects/${projectId}/usage?groupBy=credential`, {
      token: devLogin.body.accessToken as string,
    });
    expect(hidden.res.status).toBe(200);
    expect(hidden.text.includes(userCred.body.id)).toBe(false);
    expect(hidden.text.includes(projectCred.body.id)).toBe(false);

    const capped = await json(`/v1/tenants/${tenantId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ quota: { tokensPerDay: 1 } }),
    });
    expect(capped.res.status).toBe(200);
    const before = provider.seen.length;
    const blocked = await json("/llm/anthropic/v1/messages", {
      method: "POST",
      token: injected.key,
      body: JSON.stringify({ model: "claude-test" }),
    });
    expect(blocked.res.status).toBe(429);
    expect(blocked.body.error.code).toBe("QUOTA_EXCEEDED");
    expect(provider.seen.length).toBe(before);
  });

  it("keeps a graceful snapshot and rejects an immediately revoked one", async () => {
    const token = await adminToken();
    const tenant = await json("/v1/admin/tenants", {
      method: "POST",
      token,
      body: JSON.stringify({ slug: "rotate-co", name: "Rotate Co", ownerEmail: "proxy-admin@example.com" }),
    });
    const tenantId = tenant.body.id as string;
    const project = await json(`/v1/tenants/${tenantId}/projects`, {
      method: "POST",
      token,
      body: JSON.stringify({ key: "ROT", name: "Rotate" }),
    });
    const projectId = project.body.id as string;
    await json(`/v1/tenants/${tenantId}/instances`, {
      method: "POST",
      token,
      body: JSON.stringify({
        name: "oc-rotate",
        runtimeType: "opencode",
        baseUrl: runtime.baseUrl,
        auth: { username: "opencode", password: "node-secret" },
        isolation: "dedicated",
        assignedProjectIds: [projectId],
      }),
    });

    const oldKey = "sk-rotate-old-key-do-not-leak";
    const newKey = "sk-rotate-new-key-do-not-leak";
    const cred = await json("/v1/me/credentials", {
      method: "POST",
      token,
      body: JSON.stringify({
        provider: "anthropic",
        label: "rotating",
        secret: oldKey,
        metadata: { baseUrl: provider.baseUrl },
      }),
    });
    expect(cred.res.status).toBe(201);

    const session = await json(`/v1/projects/${projectId}/sessions`, {
      method: "POST",
      token,
      body: JSON.stringify({ title: "locked", credentialSource: "user", credentialId: cred.body.id }),
    });
    expect(session.res.status).toBe(201);
    expect(session.body.credential.version).toBe(1);
    await json(`/v1/sessions/${session.body.id}/messages`, {
      method: "POST",
      token,
      body: JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
    });
    const first = proxyTokenFromRuntime();
    expect(first.raw.includes(oldKey)).toBe(false);

    const graceful = await json(`/v1/me/credentials/${cred.body.id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ secret: newKey, rotationMode: "graceful" }),
    });
    expect(graceful.res.status).toBe(200);
    expect(graceful.body.version).toBe(2);
    const still = await json("/llm/anthropic/v1/messages", {
      method: "POST",
      token: first.key,
      body: JSON.stringify({ model: "claude-test" }),
    });
    expect(still.res.status).toBe(200);
    expect(provider.seen.at(-1)?.apiKey).toBe(oldKey);

    const mid = await json(`/v1/projects/${projectId}/sessions`, {
      method: "POST",
      token,
      body: JSON.stringify({ title: "current", credentialSource: "user", credentialId: cred.body.id }),
    });
    expect(mid.body.credential.version).toBe(2);
    await json(`/v1/sessions/${mid.body.id}/messages`, {
      method: "POST",
      token,
      body: JSON.stringify({ parts: [{ type: "text", text: "mid" }] }),
    });
    const midToken = proxyTokenFromRuntime();

    const immediate = await json(`/v1/me/credentials/${cred.body.id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ secret: `${newKey}-again`, rotationMode: "immediate" }),
    });
    expect(immediate.res.status).toBe(200);
    expect(immediate.body.version).toBe(3);
    const before = provider.seen.length;
    const blocked = await json("/llm/anthropic/v1/messages", {
      method: "POST",
      token: midToken.key,
      body: JSON.stringify({ model: "claude-test" }),
    });
    expect(blocked.res.status).toBe(409);
    expect(blocked.body.error.code).toBe("CREDENTIAL_ROTATED");
    expect(provider.seen.length).toBe(before);

    const oldStill = await json("/llm/anthropic/v1/messages", {
      method: "POST",
      token: first.key,
      body: JSON.stringify({ model: "claude-test" }),
    });
    expect(oldStill.res.status).toBe(200);
    expect(provider.seen.at(-1)?.apiKey).toBe(oldKey);

    const fresh = await json(`/v1/projects/${projectId}/sessions`, {
      method: "POST",
      token,
      body: JSON.stringify({ title: "fresh", credentialSource: "user", credentialId: cred.body.id }),
    });
    expect(fresh.body.credential.version).toBe(3);
    await json(`/v1/sessions/${fresh.body.id}/messages`, {
      method: "POST",
      token,
      body: JSON.stringify({ parts: [{ type: "text", text: "again" }] }),
    });
    const second = proxyTokenFromRuntime();
    expect(second.raw.includes(`${newKey}-again`)).toBe(false);
    const upgraded = await json("/llm/anthropic/v1/messages", {
      method: "POST",
      token: second.key,
      body: JSON.stringify({ model: "claude-test" }),
    });
    expect(upgraded.res.status).toBe(200);
    expect(provider.seen.at(-1)?.apiKey).toBe(`${newKey}-again`);
  });
});
