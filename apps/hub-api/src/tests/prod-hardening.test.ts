import https from "node:https";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import pino from "pino";
import { createNodeApp } from "../../../node-agent/src/app.js";
import { buildContainerCreateOptions } from "../../../node-agent/src/container-spec.js";
import { FakeDocker, volumePathFor } from "../../../node-agent/src/docker.js";
import { httpsJson, listenMtls } from "../../../node-agent/src/mtls.js";
import { runAlertDrill } from "../lib/alerts.js";
import { ensureNodeCa } from "../lib/node-ca.js";
import { logRedact } from "../lib/logger.js";
import { startHubNodeMtls } from "../lib/node-mtls.js";
import { requireNodeFingerprint } from "../lib/node-peer.js";
import { otlpMetricsJson, recordRequest, renderPrometheus } from "../lib/telemetry.js";
import { callNode } from "../services/node-client.js";
import { applyFilesOnNode, syncCommonOnNode } from "../services/node-sync.js";

const workspaceId = "55555555-5555-4555-8555-555555555555";
const tenantId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const userA = "44444444-4444-4444-8444-444444444444";
const userB = "66666666-6666-4666-8666-666666666666";

describe("P4 production hardening", () => {
  const closers: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const close of closers) await close();
  });

  it("requires mutual TLS for node apply, common sync, and the sync port", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ah-p4-"));
    const ca = await ensureNodeCa(dir);
    const root = path.join(dir, "node");
    const docker = new FakeDocker({ cpu: 4, memMb: 8192, diskGb: 40, maxWorkspaces: 4 });
    const runtime = createNodeApp({
      docker,
      capacity: { cpu: 4, memMb: 8192, diskGb: 40, maxWorkspaces: 4 },
      workspaceRoot: path.join(root, "ws"),
      commonRoot: path.join(root, "common"),
      bindIp: "127.0.0.1",
      agentVersion: "0.1.0",
    });
    const node = await listenMtls(runtime.app, {
      cert: ca.hubServerCert,
      key: ca.hubServerKey,
      ca: ca.caPem,
    });
    closers.push(async () => {
      await node.close();
    });
    const tls = { cert: ca.hubClientCert, key: ca.hubClientKey, ca: ca.caPem };
    const base = `https://127.0.0.1:${node.port}`;

    await expect(
      new Promise((resolve, reject) => {
        const req = https.request(
          { hostname: "127.0.0.1", port: node.port, path: "/health", method: "GET", ca: ca.caPem, rejectUnauthorized: true },
          (res) => {
            res.resume();
            reject(new Error(`unexpected status ${res.statusCode}`));
          },
        );
        req.on("error", resolve);
        req.end();
      }),
    ).resolves.toBeTruthy();

    await callNode(base, "/workspaces", tls, {
      method: "POST",
      body: {
        workspaceId,
        tenantId,
        projectId,
        userId: userA,
        runtimeType: "opencode",
        image: "agenthub/worker-opencode",
        resources: { cpu: 1, memMb: 512, diskGb: 5 },
        bootToken: "boot-token-value",
      },
    });
    await applyFilesOnNode(
      { address: base, tls },
      workspaceId,
      { files: [{ path: "AGENTS.md", contentBase64: Buffer.from("# hello").toString("base64") }] },
    );
    await syncCommonOnNode(
      { address: base, tls },
      workspaceId,
      { path: "docs/spec.md", contentBase64: Buffer.from("# spec").toString("base64") },
    );
    const record = runtime.record(workspaceId);
    expect(await readFile(path.join(record!.volumePath, "AGENTS.md"), "utf8")).toBe("# hello");
    expect(await readFile(path.join(record!.commonPath, "docs", "spec.md"), "utf8")).toBe("# spec");

    const hub = await startHubNodeMtls(
      {
        fetch: async (request) => {
          if (request.headers.get("authorization") !== "Bearer sync-token") {
            return new Response(JSON.stringify({ error: { message: "token" } }), { status: 401 });
          }
          return new Response(JSON.stringify({ tasks: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
      ca,
    );
    closers.push(() => hub.close());
    const syncTls = { cert: ca.syncClientCert, key: ca.syncClientKey, ca: ca.caPem };
    const denied = await httpsJson(`https://127.0.0.1:${hub.port}/v1/sync/tasks`, {
      method: "GET",
      cert: syncTls.cert,
      key: syncTls.key,
      ca: syncTls.ca,
    });
    expect(denied.status).toBe(401);
    const listed = await httpsJson(`https://127.0.0.1:${hub.port}/v1/sync/tasks`, {
      method: "GET",
      cert: syncTls.cert,
      key: syncTls.key,
      ca: syncTls.ca,
      body: undefined,
    });
    expect(listed.status).toBe(401);
    const authed = await new Promise<{ status: number }>((resolve, reject) => {
      const req = https.request(
        {
          hostname: "127.0.0.1",
          port: hub.port,
          path: "/v1/sync/tasks",
          method: "GET",
          cert: syncTls.cert,
          key: syncTls.key,
          ca: syncTls.ca,
          rejectUnauthorized: true,
          servername: "127.0.0.1",
          headers: { authorization: "Bearer sync-token" },
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0 });
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(authed.status).toBe(200);
    expect(() => requireNodeFingerprint()).toThrow(/mTLS client certificate/);
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps one container per user and leaves RLS unapplied", async () => {
    const left = volumePathFor("/var/lib/agenthub", tenantId, projectId, userA, workspaceId);
    const right = volumePathFor("/var/lib/agenthub", tenantId, projectId, userB, workspaceId);
    expect(left).not.toBe(right);
    expect(left).toContain(userA);
    const spec = buildContainerCreateOptions({
      workspaceId,
      tenantId,
      projectId,
      userId: userA,
      image: "agenthub/worker-opencode",
      resources: { cpu: 2, memMb: 4096, diskGb: 20 },
      bootToken: "boot-token-value",
      volumePath: left,
      commonPath: "/var/lib/agenthub/common",
      bindIp: "127.0.0.1",
    });
    expect(spec.name).toBe(`agenthub-${workspaceId}`);
    expect(spec.User).toBe("10001:10001");
    const scheduler = await readFile(new URL("../services/scheduler.ts", import.meta.url), "utf8");
    expect(scheduler).toContain('isolation: "dedicated"');

    const reserved = await readFile(new URL("../../../../deploy/postgres/rls-reserved.sql", import.meta.url), "utf8");
    expect(reserved).toContain("NOT APPLIED");
    expect(reserved).toContain("ENABLE ROW LEVEL SECURITY");
    const migrationDir = new URL("../../../../packages/db/drizzle/", import.meta.url);
    const files = await readdir(migrationDir);
    for (const file of files) {
      if (!file.endsWith(".sql")) continue;
      const sql = await readFile(new URL(file, migrationDir), "utf8");
      expect(sql).not.toContain("ENABLE ROW LEVEL SECURITY");
    }
  });

  it("passes the alert drill and redacts secrets", async () => {
    const drill = runAlertDrill();
    expect(drill.passed).toBe(true);
    expect(drill.quietFired).toEqual([]);
    const rules = await readFile(new URL("../../../../deploy/observability/alerts.yml", import.meta.url), "utf8");
    expect(rules).toContain("Hub5xxRatioHigh");
    expect(rules).toContain("> 0.02");
    expect(rules).toContain("node_capacity_free_ratio < 0.1");

    recordRequest("/healthz", 200, 0.01);
    const text = renderPrometheus();
    expect(text).toContain("hub_http_requests_total");
    expect(JSON.stringify(otlpMetricsJson())).toContain("hub_http_requests_total");

    let line = "";
    const stream = new Writable({
      write(chunk, _enc, done) {
        line += chunk.toString();
        done();
      },
    });
    const log = pino({ redact: logRedact }, stream);
    log.info({ secret: "sk-live-value", token: "sync-token" }, "credential saved");
    expect(line).toContain("[REDACTED]");
    expect(line).not.toContain("sk-live-value");
    expect(line).not.toContain("sync-token");
  });
});
