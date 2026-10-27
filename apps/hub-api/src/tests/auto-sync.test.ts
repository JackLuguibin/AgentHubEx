import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentSessions, createDb, runtimeInstances, workspaces } from "@agenthub/db";
import { eq, sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { createApp } from "../app.js";
import { tapAudit, type AuditEntry } from "../lib/audit.js";
import { newId } from "../lib/id.js";
import { createObjectStore } from "../lib/object-store.js";
import {
  AUTOSYNC_PER_MINUTE,
  releaseDeferredAutoSync,
  reserveAutoSyncDelay,
  startAutoSync,
  stopAutoSync,
} from "../services/auto-sync.js";
import { promoteDelayedHubJobs, useHubQueue, waitForHubDrain } from "../lib/hub-jobs.js";

useHubQueue(`hub-jobs-test-${process.pid}`);

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://agenthub:agenthub@localhost:5432/agenthub";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

async function truncateAll(db: ReturnType<typeof createDb>) {
  await db.execute(sql.raw(`
    TRUNCATE TABLE
      common_file_versions,
      common_files,
      common_protected_prefixes,
      jobs_outbox,
      apply_jobs,
      config_assignments,
      config_revisions,
      config_blobs,
      config_bundles,
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

describe("P2-02 auto sync", () => {
  const applyRoot = join(tmpdir(), `ah-autosync-apply-${Date.now()}`);
  const blobRoot = join(tmpdir(), `ah-autosync-blobs-${Date.now()}`);
  const commonRoot = join(tmpdir(), `ah-autosync-common-${Date.now()}`);
  const db = createDb(DATABASE_URL);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const applyEnv = {
    applyRoot,
    blobRoot,
    platformDek: "dev-platform-dek-32bytes-minimum!!",
    runtimeMock: true,
    publicBaseUrl: "http://hub.test",
    syncTokenSecret: "dev-sync-token-secret!!",
  };
  const { app } = createApp({
    db,
    redis,
    envOverrides: {
      APPLY_ROOT: applyRoot,
      BLOB_ROOT: blobRoot,
      COMMON_ROOT: commonRoot,
      PUBLIC_BASE_URL: "http://hub.test",
      RUNTIME_MOCK: true,
    },
  });

  beforeAll(async () => {
    await truncateAll(db);
    await redis.flushdb();
    await startAutoSync({
      db,
      applyEnv,
      store: createObjectStore({ bucket: "agenthub", region: "us-east-1", root: commonRoot }),
    });
  });

  afterAll(async () => {
    await stopAutoSync();
    await redis.quit();
  });

  async function json(path: string, init: RequestInit & { token?: string } = {}) {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type") && typeof init.body === "string") {
      headers.set("content-type", "application/json");
    }
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    const res = await app.request(path, { ...init, headers });
    const text = await res.text();
    return { res, body: text ? JSON.parse(text) : null };
  }

  async function readWhenReady(path: string) {
    let last = "";
    for (let i = 0; i < 40; i++) {
      await waitForHubDrain();
      try {
        return await readFile(path, "utf8");
      } catch (err) {
        last = err instanceof Error ? err.message : "missing";
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new Error(last);
  }

  it("keeps each project to 20 immediate pushes per minute", async () => {
    const projectId = newId();
    const delays: number[] = [];
    for (let i = 0; i < AUTOSYNC_PER_MINUTE + 1; i++) {
      delays.push(await reserveAutoSyncDelay(redis, projectId));
    }
    expect(delays[0]).toBe(0);
    expect(delays[AUTOSYNC_PER_MINUTE - 1]).toBe(0);
    expect(delays[AUTOSYNC_PER_MINUTE]).toBe(60_000);
  });

  it("syncs online workspaces after publish, leaves user files on rollback, and audits protected prefixes", async () => {
    const audits: AuditEntry[] = [];
    const stopTap = tapAudit((entry) => audits.push(entry));
    try {
      const register = await json("/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: "autosync-owner@example.com",
          password: "password-autosync-1",
          displayName: "Auto Owner",
          handle: "autosync-owner",
        }),
      });
      expect(register.res.status).toBe(201);
      await db.execute(sql`UPDATE users SET is_platform_admin = true WHERE email = 'autosync-owner@example.com'`);
      const login = await json("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "autosync-owner@example.com", password: "password-autosync-1" }),
      });
      const ownerToken = login.body.accessToken as string;
      const ownerId = login.body.user.id as string;

      const devReg = await json("/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: "autosync-dev@example.com",
          password: "password-autosync-1",
          displayName: "Auto Dev",
          handle: "autosync-dev",
        }),
      });
      expect(devReg.res.status).toBe(201);
      const devLogin = await json("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "autosync-dev@example.com", password: "password-autosync-1" }),
      });
      const devToken = devLogin.body.accessToken as string;
      const devId = devLogin.body.user.id as string;

      const remoteReg = await json("/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: "autosync-remote@example.com",
          password: "password-autosync-1",
          displayName: "Auto Remote",
          handle: "autosync-remote",
        }),
      });
      expect(remoteReg.res.status).toBe(201);
      const remoteId = remoteReg.body.user.id as string;

      const tenant = await json("/v1/admin/tenants", {
        method: "POST",
        token: ownerToken,
        body: JSON.stringify({
          slug: "autosync-co",
          name: "Autosync Co",
          ownerEmail: "autosync-owner@example.com",
        }),
      });
      expect(tenant.res.status).toBe(201);
      const switched = await json("/v1/auth/switch-tenant", {
        method: "POST",
        token: ownerToken,
        body: JSON.stringify({ tenantId: tenant.body.id }),
      });
      const token = switched.body.accessToken as string;
      const project = await json(`/v1/tenants/${tenant.body.id}/projects`, {
        method: "POST",
        token,
        body: JSON.stringify({ key: "ASY", name: "Autosync Project" }),
      });
      expect(project.res.status).toBe(201);
      const projectId = project.body.id as string;

      for (const [email, role] of [
        ["autosync-dev@example.com", "developer"],
        ["autosync-remote@example.com", "developer"],
      ] as const) {
        const invite = await json(`/v1/tenants/${tenant.body.id}/invitations`, {
          method: "POST",
          token,
          body: JSON.stringify({
            email,
            tenantRole: "member",
            projectGrants: [{ projectId, role }],
          }),
        });
        expect(invite.res.status).toBe(201);
      }

      const readyVolume = await mkdtemp(join(tmpdir(), "ah-ready-"));
      const busyVolume = await mkdtemp(join(tmpdir(), "ah-busy-"));
      const stoppedVolume = await mkdtemp(join(tmpdir(), "ah-stopped-"));
      const readyId = newId();
      const busyId = newId();
      const stoppedId = newId();
      const failedId = newId();
      const instanceId = newId();
      await db.insert(runtimeInstances).values({
        id: instanceId,
        tenantId: tenant.body.id,
        name: "ext-nosync",
        mode: "external",
        runtimeType: "opencode",
        baseUrl: "http://127.0.0.1:9",
        hasSyncAgent: false,
      });
      await db.insert(workspaces).values([
        {
          id: readyId,
          tenantId: tenant.body.id,
          projectId,
          ownerUserId: ownerId,
          kind: "personal",
          runtimeType: "opencode",
          status: "ready",
          volumePath: readyVolume,
          spec: {},
        },
        {
          id: busyId,
          tenantId: tenant.body.id,
          projectId,
          ownerUserId: devId,
          kind: "personal",
          runtimeType: "opencode",
          status: "ready",
          volumePath: busyVolume,
          spec: {},
        },
        {
          id: stoppedId,
          tenantId: tenant.body.id,
          projectId,
          ownerUserId: ownerId,
          kind: "personal",
          runtimeType: "claude",
          status: "stopped",
          volumePath: stoppedVolume,
          spec: {},
        },
        {
          id: failedId,
          tenantId: tenant.body.id,
          projectId,
          ownerUserId: remoteId,
          kind: "personal",
          runtimeType: "opencode",
          status: "ready",
          instanceId,
          spec: {},
        },
      ]);
      const sessionId = newId();
      await db.insert(agentSessions).values({
        id: sessionId,
        tenantId: tenant.body.id,
        projectId,
        workspaceId: busyId,
        ownerUserId: devId,
        title: "generating",
        runtimeType: "opencode",
        credentialSource: "user",
        credentialId: newId(),
        credentialVersion: 1,
        status: "busy",
      });

      const created = await json(`/v1/projects/${projectId}/bundles`, {
        method: "POST",
        token,
        body: JSON.stringify({ name: "project" }),
      });
      expect(created.res.status).toBe(201);
      const bundleId = created.body.id as string;
      const saved = await json(`/v1/bundles/${bundleId}/draft`, {
        method: "PUT",
        token,
        headers: { "if-match": created.body.etag },
        body: JSON.stringify({
          agents: [{ name: "build", description: "Build", mode: "primary", prompt: "version one" }],
          mcp: [],
          skills: [],
          instructions: { agentsMd: "version one rules" },
        }),
      });
      expect(saved.res.status).toBe(200);
      const published = await json(`/v1/bundles/${bundleId}/publish`, {
        method: "POST",
        token,
        headers: { "idempotency-key": "autosync-publish-v1" },
        body: JSON.stringify({ changelog: "v1" }),
      });
      expect(published.res.status).toBe(201);

      const readyText = await readWhenReady(join(readyVolume, "AGENTS.md"));
      expect(readyText).toContain("version one rules");
      await expect(readFile(join(busyVolume, "AGENTS.md"))).rejects.toThrow();
      await expect(readFile(join(stoppedVolume, "AGENTS.md"))).rejects.toThrow();

      const jobs = await json(`/v1/projects/${projectId}/apply-jobs`, { token });
      expect(
        jobs.body.items.some(
          (job: { workspaceId: string; status: string; trigger: string }) =>
            job.workspaceId === failedId && job.trigger === "publish" && job.status === "partial",
        ),
      ).toBe(true);
      expect(audits.some((entry) => entry.action === "apply.autosync" && entry.meta?.status === "succeeded")).toBe(
        true,
      );
      expect(audits.some((entry) => entry.action === "apply.autosync" && entry.meta?.status === "partial")).toBe(
        true,
      );

      await mkdir(join(readyVolume, ".opencode"), { recursive: true });
      await writeFile(join(readyVolume, "notes.txt"), "user file");
      await writeFile(join(readyVolume, ".opencode", "my-notes.md"), "mine");

      await db.update(agentSessions).set({ status: "idle" }).where(eq(agentSessions.id, sessionId));
      await releaseDeferredAutoSync(db, redis, busyId);
      expect(await readWhenReady(join(busyVolume, "AGENTS.md"))).toContain("version one rules");

      const listed = await json(`/v1/bundles/${bundleId}`, { token });
      const saved2 = await json(`/v1/bundles/${bundleId}/draft`, {
        method: "PUT",
        token,
        headers: { "if-match": listed.body.etag },
        body: JSON.stringify({
          agents: [
            { name: "build", description: "Build", mode: "primary", prompt: "version two" },
            { name: "plan", description: "Plan", prompt: "plan only" },
          ],
          mcp: [],
          skills: [],
          instructions: { agentsMd: "version two rules" },
        }),
      });
      expect(saved2.res.status).toBe(200);
      const published2 = await json(`/v1/bundles/${bundleId}/publish`, {
        method: "POST",
        token,
        headers: { "idempotency-key": "autosync-publish-v2" },
        body: JSON.stringify({}),
      });
      expect(published2.res.status).toBe(201);
      expect(await readWhenReady(join(readyVolume, ".opencode/agents/plan.md"))).toContain("plan only");
      expect(await readFile(join(readyVolume, "notes.txt"), "utf8")).toBe("user file");
      expect(await readFile(join(readyVolume, ".opencode/my-notes.md"), "utf8")).toBe("mine");

      const rolled = await json(`/v1/bundles/${bundleId}/rollback`, {
        method: "POST",
        token,
        body: JSON.stringify({ revisionId: published.body.id }),
      });
      expect(rolled.res.status).toBe(200);
      expect(await readFile(join(readyVolume, "AGENTS.md"), "utf8")).toContain("version one rules");
      expect(await readFile(join(readyVolume, ".opencode/agents/build.md"), "utf8")).toContain("version one");
      await expect(readFile(join(readyVolume, ".opencode/agents/plan.md"))).rejects.toThrow();
      expect(await readFile(join(readyVolume, "notes.txt"), "utf8")).toBe("user file");
      expect(await readFile(join(readyVolume, ".opencode/my-notes.md"), "utf8")).toBe("mine");
      expect(
        audits.some(
          (entry) => entry.action === "apply.autosync" && entry.meta?.trigger === "rollback",
        ),
      ).toBe(true);

      const settings = await json(`/v1/projects/${projectId}/common/settings`, {
        method: "PUT",
        token,
        body: JSON.stringify({
          protectedPrefixes: ["docs"],
          syncPolicy: "on_common_publish",
        }),
      });
      expect(settings.res.status).toBe(200);
      expect(audits.some((entry) => entry.action === "common.protected_prefixes")).toBe(true);

      const upload = new FormData();
      upload.set("prefix", "fixtures");
      upload.append("files", new File(["fixture"], "note.txt", { type: "text/plain" }));
      const uploaded = await app.request(`/v1/projects/${projectId}/common/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${devToken}`, "idempotency-key": "autosync-upload-01" },
        body: upload,
      });
      expect(uploaded.status).toBe(201);

      const moved = await json(`/v1/projects/${projectId}/common/files/fixtures/note.txt`, {
        method: "PATCH",
        token: devToken,
        body: JSON.stringify({ moveTo: "docs/note.txt" }),
      });
      expect(moved.res.status).toBe(403);
      expect(moved.body.error.code).toBe("PROTECTED_PATH");

      const denied = await json(`/v1/projects/${projectId}/common/files/docs/secret.md`, {
        method: "PUT",
        token: devToken,
        headers: { "content-type": "text/markdown" },
        body: "# nope\n",
      });
      expect(denied.res.status).toBe(403);
      expect(audits.filter((entry) => entry.action === "common.protected_denied").length).toBeGreaterThanOrEqual(2);

      const spec = await json(`/v1/projects/${projectId}/common/files/docs/spec.md`, {
        method: "PUT",
        token,
        headers: { "content-type": "text/markdown" },
        body: "# spec\n",
      });
      expect(spec.res.status).toBe(200);
      expect(audits.some((entry) => entry.action === "common.protected_write" && entry.meta?.path === "docs/spec.md")).toBe(
        true,
      );

      await promoteDelayedHubJobs();
      expect(await readWhenReady(join(readyVolume, "project-common", "docs", "spec.md"))).toContain("# spec");
      expect(await readFile(join(readyVolume, "notes.txt"), "utf8")).toBe("user file");
      const commonJobs = await json(`/v1/projects/${projectId}/apply-jobs`, { token });
      expect(
        commonJobs.body.items.some(
          (job: { kind: string; status: string; trigger: string }) =>
            job.kind === "common" && job.trigger === "publish" && job.status === "succeeded",
        ),
      ).toBe(true);
    } finally {
      stopTap();
    }
  });
});
