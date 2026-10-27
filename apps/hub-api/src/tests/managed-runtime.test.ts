import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import { createDb, nodes, users, workspaces } from "@agenthub/db";
import { eq, sql } from "drizzle-orm";
import { Redis } from "ioredis";
import type { AddressInfo } from "node:net";
import { FakeDocker } from "../../../node-agent/src/docker.js";
import { bootNodeAgent } from "../../../node-agent/src/boot.js";
import { createApp } from "../app.js";
import { ensureNodeCa } from "../lib/node-ca.js";
import { startHubNodeMtls } from "../lib/node-mtls.js";
import { sweepIdleWorkspaces } from "../services/idle.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://agenthub:agenthub@localhost:5432/agenthub";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

describe("P2-01 managed node agent", () => {
  const db = createDb(DATABASE_URL);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, enableReadyCheck: false });
  const caDir = path.join(tmpdir(), `agenthub-ca-${process.pid}`);
  const stateDir = path.join(tmpdir(), `agenthub-node-${process.pid}`);
  const { app } = createApp({
    db,
    redis,
    envOverrides: { RUNTIME_MOCK: true, NODE_CA_DIR: caDir, NODE_MTLS_PORT: 0 },
  });
  let http: ReturnType<typeof serve>;
  let mtls: { port: number; close: () => Promise<void> };
  let agent: Awaited<ReturnType<typeof bootNodeAgent>>;

  beforeAll(async () => {
    await db.execute(sql.raw(`
      TRUNCATE TABLE
        agent_sessions,
        workspaces,
        project_issues,
        project_runtime_bindings,
        runtime_instances,
        node_bootstrap_tokens,
        nodes,
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
    await redis.flushdb();
    await ensureNodeCa(caDir);
    http = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => http.once("listening", () => resolve()));
    const ca = await ensureNodeCa(caDir);
    mtls = await startHubNodeMtls(app, ca, 0);
  }, 120_000);

  afterAll(async () => {
    await agent?.close();
    await mtls?.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await redis.quit();
  });

  async function json(pathname: string, init: RequestInit & { token?: string } = {}) {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("content-type", "application/json");
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    const res = await app.request(pathname, { ...init, headers });
    const text = await res.text();
    return { res, body: text ? JSON.parse(text) : null };
  }

  it("schedules managed workspaces under 120s and enforces quota, policy, and idle stop", async () => {
    const register = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "p2-admin@example.com",
        password: "password-node-agent-1",
        displayName: "P2 Admin",
        handle: "p2admin",
      }),
    });
    expect(register.res.status).toBe(201);
    await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.email, "p2-admin@example.com"));
    const login = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "p2-admin@example.com", password: "password-node-agent-1" }),
    });
    const token = login.body.accessToken as string;

    const tenant = await json("/v1/admin/tenants", {
      method: "POST",
      token,
      body: JSON.stringify({ slug: "p2node", name: "P2", ownerEmail: "p2-admin@example.com" }),
    });
    expect(tenant.res.status).toBe(201);
    const tenantId = tenant.body.id as string;

    const bad = await json("/v1/nodes/register", {
      method: "POST",
      body: JSON.stringify({
        token: "not-a-real-bootstrap-token-value",
        csr: "-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----",
        capacity: { cpu: 4, memMb: 4096, diskGb: 20, maxWorkspaces: 2 },
        labels: {},
        agentVersion: "0.1.0",
      }),
    });
    expect(bad.res.status).toBe(401);
    expect(bad.body.error.code).toBe("BOOTSTRAP_INVALID");

    const bootToken = await json("/v1/admin/nodes/bootstrap-tokens", {
      method: "POST",
      token,
      body: JSON.stringify({ labels: { pool: "default" }, ttlMinutes: 60 }),
    });
    expect(bootToken.res.status).toBe(201);
    expect(bootToken.body.token).toBeTruthy();
    expect(bootToken.body.installCommand).toContain("BOOTSTRAP_TOKEN=");

    const httpPort = (http.address() as AddressInfo).port;
    const docker = new FakeDocker({ cpu: 64, memMb: 131072, diskGb: 800, maxWorkspaces: 40 });
    agent = await bootNodeAgent({
      hubUrl: `http://127.0.0.1:${httpPort}`,
      hubMtlsUrl: `https://127.0.0.1:${mtls.port}`,
      bootstrapToken: bootToken.body.token,
      docker,
      workspaceRoot: path.join(stateDir, "ws"),
      commonRoot: path.join(stateDir, "common"),
      stateDir,
      labels: { pool: "default" },
      capacity: { cpu: 64, memMb: 131072, diskGb: 800, maxWorkspaces: 40 },
    });
    const listed = await json("/v1/admin/nodes", { token });
    expect(listed.res.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].lastHeartbeatAt).toBeTruthy();

    const plainHeartbeat = await json("/v1/nodes/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        used: { cpu: 0, memMb: 0, diskGb: 0, workspaces: 0 },
        workspaces: [],
        agentVersion: "0.1.0",
        wallTime: new Date().toISOString(),
      }),
    });
    expect(plainHeartbeat.res.status).toBe(401);

    const samples: number[] = [];
    const workspaceIds: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const key = `P2A${i}`;
      const project = await json(`/v1/tenants/${tenantId}/projects`, {
        method: "POST",
        token,
        body: JSON.stringify({
          key,
          name: key,
          settings: { runtimeDelivery: "managed" },
        }),
      });
      expect(project.res.status).toBe(201);
      const bound = await json(`/v1/projects/${project.body.id}/bindings`, {
        method: "PUT",
        token,
        body: JSON.stringify({
          bindings: [{ runtimeType: "opencode", labelSelector: { pool: "default" }, priority: 1 }],
        }),
      });
      expect(bound.res.status).toBe(200);
      const started = performance.now();
      const ws = await json(`/v1/projects/${project.body.id}/workspaces/me`, { token });
      samples.push(performance.now() - started);
      expect(ws.res.status).toBe(200);
      expect(ws.body.status).toBe("ready");
      expect(ws.body.mode).toBe("managed");
      workspaceIds.push(ws.body.id);
    }
    expect(p95(samples)).toBeLessThan(120_000);
    const running = await docker.list();
    expect(running).toHaveLength(8);
    expect(JSON.stringify(docker.inspect(workspaceIds[0]!)?.options)).not.toContain("docker.sock");
    expect(docker.inspect(workspaceIds[0]!)?.options.Image).toBe("agenthub/worker-opencode");

    const cred = await json("/v1/me/credentials", {
      method: "POST",
      token,
      body: JSON.stringify({ provider: "opencode", label: "p2", secret: "sk-p2-managed" }),
    });
    expect(cred.res.status).toBe(201);
    const session = await json(`/v1/projects/${(await projectIdOf(token, tenantId, "P2A0"))}/sessions`, {
      method: "POST",
      token,
      body: JSON.stringify({ title: "managed session", credentialSource: "user", credentialId: cred.body.id }),
    });
    expect(session.res.status).toBe(201);
    expect(session.body.workspaceId).toBe(workspaceIds[0]);

    const idleTarget = workspaceIds[7]!;
    await db
      .update(workspaces)
      .set({ lastActiveAt: new Date(Date.now() - 31 * 60 * 1000), status: "ready" })
      .where(eq(workspaces.id, idleTarget));
    const ca = await ensureNodeCa(caDir);
    await sweepIdleWorkspaces(db, {
      idleTtlMs: 30 * 60 * 1000,
      stopTtlMs: 24 * 60 * 60 * 1000,
      tls: { cert: ca.hubClientCert, key: ca.hubClientKey, ca: ca.caPem },
    });
    const idled = await db.select().from(workspaces).where(eq(workspaces.id, idleTarget)).limit(1);
    expect(idled[0]?.status).toBe("idle");
    expect(docker.inspect(idleTarget)?.state).toBe("running");

    await db
      .update(workspaces)
      .set({ lastActiveAt: new Date(Date.now() - 25 * 60 * 60 * 1000), status: "idle" })
      .where(eq(workspaces.id, idleTarget));
    await sweepIdleWorkspaces(db, {
      idleTtlMs: 30 * 60 * 1000,
      stopTtlMs: 24 * 60 * 60 * 1000,
      tls: { cert: ca.hubClientCert, key: ca.hubClientKey, ca: ca.caPem },
    });
    const stopped = await db.select().from(workspaces).where(eq(workspaces.id, idleTarget)).limit(1);
    expect(stopped[0]?.status).toBe("stopped");
    expect(docker.inspect(idleTarget)?.state).toBe("stopped");
    const restarted = await json(`/v1/workspaces/${idleTarget}/start`, { method: "POST", token });
    expect(restarted.res.status).toBe(200);
    expect(restarted.body.status).toBe("ready");
    expect(docker.inspect(idleTarget)?.state).toBe("running");

    const external = await json(`/v1/tenants/${tenantId}/projects`, {
      method: "POST",
      token,
      body: JSON.stringify({ key: "P2EXT", name: "External", credentialPolicy: "project_only" }),
    });
    expect(external.res.status).toBe(201);
    const denied = await json(`/v1/projects/${external.body.id}/sessions`, {
      method: "POST",
      token,
      body: JSON.stringify({ title: "policy", credentialSource: "user", credentialId: cred.body.id }),
    });
    expect(denied.res.status).toBe(409);
    expect(denied.body.error.code).toBe("CREDENTIAL_POLICY_VIOLATION");

    const tightSessions = await json(`/v1/tenants/${tenantId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ quota: { maxConcurrentSessionsPerUser: 1 } }),
    });
    expect(tightSessions.res.status).toBe(200);
    const second = await json(`/v1/projects/${(await projectIdOf(token, tenantId, "P2A0"))}/sessions`, {
      method: "POST",
      token,
      body: JSON.stringify({ title: "second", credentialSource: "user", credentialId: cred.body.id }),
    });
    expect(second.res.status).toBe(429);
    expect(second.body.error.details.quota).toBe("maxConcurrentSessionsPerUser");
    const stillThere = await json(`/v1/sessions/${session.body.id}`, { token });
    expect(stillThere.res.status).toBe(200);

    await json(`/v1/tenants/${tenantId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ quota: { maxActiveWorkspaces: 1, maxConcurrentSessionsPerUser: 5 } }),
    });
    const overflow = await json(`/v1/tenants/${tenantId}/projects`, {
      method: "POST",
      token,
      body: JSON.stringify({ key: "P2FULL", name: "Full", settings: { runtimeDelivery: "managed" } }),
    });
    const overflowWs = await json(`/v1/projects/${overflow.body.id}/workspaces/me`, { token });
    expect(overflowWs.res.status).toBe(429);
    expect(overflowWs.body.error.details.quota).toBe("maxActiveWorkspaces");

    await json(`/v1/tenants/${tenantId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ quota: { maxActiveWorkspaces: 50 } }),
    });
    const nodeRow = await db.select().from(nodes).limit(1);
    const drained = await json(`/v1/admin/nodes/${nodeRow[0]!.id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ status: "draining" }),
    });
    expect(drained.res.status).toBe(200);
    const blocked = await json(`/v1/tenants/${tenantId}/projects`, {
      method: "POST",
      token,
      body: JSON.stringify({
        key: "P2DRN",
        name: "Drain",
        settings: { runtimeDelivery: "managed" },
      }),
    });
    const blockedWs = await json(`/v1/projects/${blocked.body.id}/workspaces/me`, { token });
    expect(blockedWs.res.status).toBe(409);
    expect(blockedWs.body.error.code).toBe("WORKSPACE_NOT_READY");
    expect(blockedWs.body.error.details.reason).toBe("NO_CAPACITY");
  }, 120_000);

  async function projectIdOf(token: string, tenantId: string, key: string) {
    const page = await json(`/v1/tenants/${tenantId}/projects`, { token });
    const found = (page.body.items as Array<{ id: string; key: string }>).find((item) => item.key === key);
    if (!found) throw new Error(`missing project ${key}`);
    return found.id;
  }
});
