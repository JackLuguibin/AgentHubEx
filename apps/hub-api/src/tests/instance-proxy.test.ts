import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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

type SeenRequest = { method: string; url: string; headers: IncomingHttpHeaders };

/** Minimal fake `opencode serve` that records what the Hub forwards. */
function startFakeOpencode() {
  const seen: SeenRequest[] = [];
  const server = createServer((req, res) => {
    seen.push({ method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers });
    const url = new URL(req.url ?? "/", "http://upstream");
    if (url.pathname === "/global/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ healthy: true }));
      return;
    }
    if (url.pathname === "/file") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([{ name: "README.md", type: "file" }]));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ unexpected: url.pathname }));
  });
  return new Promise<{ server: Server; baseUrl: string; seen: SeenRequest[] }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, seen });
    });
  });
}

describe("P1-03 external instance + agent proxy", () => {
  const db = createDb(DATABASE_URL);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const { app } = createApp({
    db,
    redis,
    envOverrides: { RUNTIME_MOCK: false, DEPLOY_PROFILE: "intranet" },
  });
  let upstream: Awaited<ReturnType<typeof startFakeOpencode>>;

  beforeAll(async () => {
    await truncateAll(db);
    await redis.flushdb();
    upstream = await startFakeOpencode();
  });

  afterAll(async () => {
    if (upstream.server.listening) upstream.server.close();
    await redis.quit();
  });

  async function json(path: string, init: RequestInit & { token?: string } = {}) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    const res = await app.request(path, { ...init, headers });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    return { res, body, text };
  }

  async function registerAndLogin(email: string, handle: string) {
    const reg = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email,
        password: `password-${handle}-1`,
        displayName: handle,
        handle,
      }),
    });
    expect(reg.res.status).toBe(201);
    return { token: reg.body.accessToken as string, userId: reg.body.user.id as string };
  }

  it("registers dedicated instance, proxies allowlisted paths, blocks the rest", async () => {
    const admin = await registerAndLogin("ops@example.com", "ops");
    await db.execute(sql`UPDATE users SET is_platform_admin = true WHERE id = ${admin.userId}`);
    const login = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ops@example.com", password: "password-ops-1" }),
    });
    const token = login.body.accessToken as string;

    const tenant = await json("/v1/admin/tenants", {
      method: "POST",
      token,
      body: JSON.stringify({ slug: "proxy-co", name: "Proxy Co", ownerEmail: "ops@example.com" }),
    });
    expect(tenant.res.status).toBe(201);
    const tenantId = tenant.body.id as string;

    const project = await json(`/v1/tenants/${tenantId}/projects`, {
      method: "POST",
      token,
      body: JSON.stringify({ key: "PX", name: "Proxy" }),
    });
    const projectId = project.body.id as string;

    const auth = { username: "opencode", password: "node-secret-123" };

    const test = await json(`/v1/tenants/${tenantId}/instances/test`, {
      method: "POST",
      token,
      body: JSON.stringify({ runtimeType: "opencode", baseUrl: upstream.baseUrl, auth }),
    });
    expect(test.res.status).toBe(200);
    expect(test.body.ok).toBe(true);

    const shared = await json(`/v1/tenants/${tenantId}/instances`, {
      method: "POST",
      token,
      body: JSON.stringify({
        name: "oc-shared",
        runtimeType: "opencode",
        baseUrl: upstream.baseUrl,
        isolation: "shared",
      }),
    });
    expect(shared.res.status).toBe(409);

    const created = await json(`/v1/tenants/${tenantId}/instances`, {
      method: "POST",
      token,
      body: JSON.stringify({
        name: "oc-dedicated",
        runtimeType: "opencode",
        baseUrl: upstream.baseUrl,
        auth,
        isolation: "dedicated",
        assignedProjectIds: [projectId],
      }),
    });
    expect(created.res.status).toBe(201);
    expect(created.body.health).toBe("healthy");
    expect(created.text).not.toContain("node-secret-123");
    const instanceId = created.body.id as string;

    const bindings = await json(`/v1/projects/${projectId}/bindings`, { token });
    expect(bindings.body.bindings).toHaveLength(1);
    expect(bindings.body.bindings[0].instanceId).toBe(instanceId);

    const ws = await json(`/v1/projects/${projectId}/workspaces/me`, { token });
    expect(ws.res.status).toBe(200);
    expect(ws.body.status).toBe("ready");
    expect(ws.body.instance.id).toBe(instanceId);
    expect(ws.text).not.toContain(upstream.baseUrl);
    expect(ws.text).not.toContain("node-secret-123");
    const workspaceId = ws.body.id as string;

    upstream.seen.length = 0;
    const file = await json(`/v1/workspaces/${workspaceId}/agent/file?path=/`, { token });
    expect(file.res.status).toBe(200);
    expect(file.body[0].name).toBe("README.md");
    expect(file.text).not.toContain(upstream.baseUrl);
    const forwarded = upstream.seen.find((r) => r.url.startsWith("/file"));
    expect(forwarded?.url).toBe("/file?path=/");
    const expectedBasic = `Basic ${Buffer.from("opencode:node-secret-123").toString("base64")}`;
    expect(forwarded?.headers.authorization).toBe(expectedBasic);

    upstream.seen.length = 0;
    for (const [method, path] of [
      ["GET", "event"],
      ["POST", "session"],
      ["GET", "session"],
      ["GET", "global/health"],
      ["PUT", "auth/anthropic"],
      ["PATCH", "config"],
      ["POST", "mcp"],
    ] as const) {
      const blocked = await json(`/v1/workspaces/${workspaceId}/agent/${path}`, {
        method,
        token,
        body: method === "GET" ? undefined : "{}",
      });
      expect(blocked.res.status, `${method} ${path}`).toBe(403);
      expect(blocked.body.error.code).toBe("BLOCKED_UPSTREAM_PATH");
    }
    expect(upstream.seen).toHaveLength(0);

    // A second member cannot take the dedicated instance already serving the first workspace.
    const dev = await registerAndLogin("dev@example.com", "dev");
    const invite = await json(`/v1/tenants/${tenantId}/invitations`, {
      method: "POST",
      token,
      body: JSON.stringify({
        email: "dev@example.com",
        tenantRole: "member",
        projectGrants: [{ projectId, role: "developer" }],
      }),
    });
    expect(invite.res.status).toBe(201);
    const devWs = await json(`/v1/projects/${projectId}/workspaces/me`, { token: dev.token });
    expect(devWs.res.status).toBe(409);

    // Non-admins never see the node address.
    const devList = await json(`/v1/tenants/${tenantId}/instances`, { token: dev.token });
    expect(devList.res.status).toBe(200);
    expect(devList.text).not.toContain(upstream.baseUrl);

    // Another user's workspace is not reachable through the proxy.
    const foreign = await json(`/v1/workspaces/${workspaceId}/agent/file?path=/`, {
      token: dev.token,
    });
    expect(foreign.res.status).toBe(404);

    const inUse = await json(`/v1/instances/${instanceId}`, { method: "DELETE", token });
    expect(inUse.res.status).toBe(409);
    expect(inUse.body.error.code).toBe("INSTANCE_IN_USE");

    // Offline instance: probe marks unhealthy and config apply is blocked.
    await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    const probe = await json(`/v1/instances/${instanceId}/probe`, { method: "POST", token });
    expect(probe.res.status).toBe(200);
    expect(probe.body.health).toBe("unhealthy");

    const sync = await json(`/v1/workspaces/${workspaceId}/sync-config`, {
      method: "POST",
      token,
    });
    expect(sync.res.status).toBe(409);
  });
});
