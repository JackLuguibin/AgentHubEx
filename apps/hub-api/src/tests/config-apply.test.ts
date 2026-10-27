import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runtimeInstances, workspaces } from "@agenthub/db";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { createApp } from "../app.js";
import { newId } from "../lib/id.js";
import { syncPublicKey } from "../lib/sync-crypto.js";
import { syncOnce } from "../../../agenthub-sync/src/sync.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://agenthub:agenthub@localhost:5432/agenthub";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

async function truncateAll(db: ReturnType<typeof createDb>) {
  await db.execute(sql.raw(`
    TRUNCATE TABLE
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

describe("P1-04 config apply", () => {
  const applyRoot = join(tmpdir(), `ah-apply-root-${Date.now()}`);
  const blobRoot = join(tmpdir(), `ah-blobs-${Date.now()}`);
  const db = createDb(DATABASE_URL);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const { app } = createApp({
    db,
    redis,
    envOverrides: {
      APPLY_ROOT: applyRoot,
      BLOB_ROOT: blobRoot,
      PUBLIC_BASE_URL: "http://hub.test",
      RUNTIME_MOCK: true,
    },
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
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    const res = await app.request(path, { ...init, headers });
    const text = await res.text();
    return { res, body: text ? JSON.parse(text) : null };
  }

  it("publishes a bundle, applies it, and rollback restores managed files", async () => {
    const register = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "config-owner@example.com",
        password: "password-config-1",
        displayName: "Config Owner",
        handle: "config-owner",
      }),
    });
    expect(register.res.status).toBe(201);
    await db.execute(sql`UPDATE users SET is_platform_admin = true WHERE email = 'config-owner@example.com'`);
    const login = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "config-owner@example.com",
        password: "password-config-1",
      }),
    });
    const token = login.body.accessToken as string;
    const userId = login.body.user.id as string;

    const tenant = await json("/v1/admin/tenants", {
      method: "POST",
      token,
      body: JSON.stringify({
        slug: "config-co",
        name: "Config Co",
        ownerEmail: "config-owner@example.com",
      }),
    });
    expect(tenant.res.status).toBe(201);
    const switched = await json("/v1/auth/switch-tenant", {
      method: "POST",
      token,
      body: JSON.stringify({ tenantId: tenant.body.id }),
    });
    const tenantToken = switched.body.accessToken as string;

    const project = await json(`/v1/tenants/${tenant.body.id}/projects`, {
      method: "POST",
      token: tenantToken,
      body: JSON.stringify({ key: "CFG", name: "Config Project" }),
    });
    expect(project.res.status).toBe(201);
    const projectId = project.body.id as string;

    const volume = await mkdtemp(join(tmpdir(), "ah-ws-"));
    const workspaceId = newId();
    await db.insert(workspaces).values({
      id: workspaceId,
      tenantId: tenant.body.id,
      projectId,
      ownerUserId: userId,
      kind: "personal",
      runtimeType: "opencode",
      status: "ready",
      volumePath: volume,
      spec: {},
    });

    const created = await json(`/v1/projects/${projectId}/bundles`, {
      method: "POST",
      token: tenantToken,
      body: JSON.stringify({ name: "project" }),
    });
    expect(created.res.status).toBe(201);
    const bundleId = created.body.id as string;

    const skill = await json(`/v1/bundles/${bundleId}/skills/import`, {
      method: "POST",
      token: tenantToken,
      body: JSON.stringify({
        name: "api-conventions",
        files: [{ path: "SKILL.md", content: "# API conventions\n" }],
      }),
    });
    expect(skill.res.status).toBe(201);

    const listed = await json(`/v1/projects/${projectId}/bundles`, { token: tenantToken });
    const current = listed.body.items[0];
    const draft = {
      ...current.draft,
      agents: [
        {
          name: "build",
          description: "Build features",
          mode: "primary",
          prompt: "version one",
        },
      ],
      mcp: [
        {
          name: "docs",
          transport: "local",
          command: ["npx", "-y", "docs-mcp"],
          enabled: true,
        },
      ],
      instructions: { agentsMd: "Follow the API conventions." },
    };
    const saved = await json(`/v1/bundles/${bundleId}/draft`, {
      method: "PUT",
      token: tenantToken,
      headers: { "if-match": current.etag },
      body: JSON.stringify(draft),
    });
    expect(saved.res.status).toBe(200);

    const published = await json(`/v1/bundles/${bundleId}/publish`, {
      method: "POST",
      token: tenantToken,
      headers: { "idempotency-key": "publish-v1-key" },
      body: JSON.stringify({ changelog: "initial" }),
    });
    expect(published.res.status).toBe(201);
    expect(published.body.version).toBe(1);
    const again = await json(`/v1/bundles/${bundleId}/publish`, {
      method: "POST",
      token: tenantToken,
      headers: { "idempotency-key": "publish-v1-key" },
      body: JSON.stringify({ changelog: "initial" }),
    });
    expect(again.body.id).toBe(published.body.id);

    const applied = await json(`/v1/projects/${projectId}/config/apply`, {
      method: "POST",
      token: tenantToken,
      headers: { "idempotency-key": "apply-v1-key" },
      body: JSON.stringify({}),
    });
    expect(applied.res.status).toBe(200);
    expect(applied.body.jobs).toHaveLength(1);
    expect(applied.body.jobs[0].status).toBe("succeeded");
    expect(await readFile(join(volume, "AGENTS.md"), "utf8")).toContain("Follow the API conventions.");
    expect(await readFile(join(volume, ".opencode/agents/build.md"), "utf8")).toContain("version one");
    expect(await readFile(join(volume, ".opencode/skills/api-conventions/SKILL.md"), "utf8")).toContain(
      "API conventions",
    );
    const opencode = JSON.parse(await readFile(join(volume, "opencode.json"), "utf8")) as {
      mcp: Record<string, unknown>;
    };
    expect(opencode.mcp.docs).toBeTruthy();
    await writeFile(join(volume, "notes.txt"), "user file");

    const listed2 = await json(`/v1/projects/${projectId}/bundles`, { token: tenantToken });
    const draft2 = {
      ...listed2.body.items[0].draft,
      agents: [
        {
          name: "build",
          description: "Build features",
          mode: "primary",
          prompt: "version two",
        },
        { name: "plan", description: "Plan work", prompt: "plan only" },
      ],
      instructions: { agentsMd: "Version two rules." },
    };
    const saved2 = await json(`/v1/bundles/${bundleId}/draft`, {
      method: "PUT",
      token: tenantToken,
      headers: { "if-match": listed2.body.items[0].etag },
      body: JSON.stringify(draft2),
    });
    expect(saved2.res.status).toBe(200);
    const published2 = await json(`/v1/bundles/${bundleId}/publish`, {
      method: "POST",
      token: tenantToken,
      headers: { "idempotency-key": "publish-v2-key" },
      body: JSON.stringify({}),
    });
    expect(published2.res.status).toBe(201);
    const applied2 = await json(`/v1/projects/${projectId}/config/apply`, {
      method: "POST",
      token: tenantToken,
      headers: { "idempotency-key": "apply-v2-key" },
      body: JSON.stringify({}),
    });
    expect(applied2.body.jobs[0].status).toBe("succeeded");
    expect(await readFile(join(volume, ".opencode/agents/plan.md"), "utf8")).toContain("plan only");

    const rolled = await json(`/v1/bundles/${bundleId}/rollback`, {
      method: "POST",
      token: tenantToken,
      body: JSON.stringify({ revisionId: published.body.id }),
    });
    expect(rolled.res.status).toBe(200);
    expect(rolled.body.version).toBe(1);
    expect(rolled.body.state).toBe("published");
    expect(await readFile(join(volume, "AGENTS.md"), "utf8")).toContain("Follow the API conventions.");
    expect(await readFile(join(volume, ".opencode/agents/build.md"), "utf8")).toContain("version one");
    await expect(readFile(join(volume, ".opencode/agents/plan.md"))).rejects.toThrow();
    expect(await readFile(join(volume, "notes.txt"), "utf8")).toBe("user file");
    expect(await readFile(join(volume, ".opencode/skills/api-conventions/SKILL.md"), "utf8")).toContain(
      "API conventions",
    );

    const jobs = await json(`/v1/projects/${projectId}/apply-jobs`, { token: tenantToken });
    expect(jobs.body.items.some((job: { status: string; trigger: string }) => job.trigger === "rollback" && job.status === "succeeded")).toBe(true);
  });

  it("lets agenthub-sync pull an external bundle and write it", async () => {
    const login = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "config-owner@example.com",
        password: "password-config-1",
      }),
    });
    const token = login.body.accessToken as string;
    const userId = login.body.user.id as string;
    const me = await json("/v1/me", { token });
    const tenantId = me.body.tenants[0].id as string;
    const switched = await json("/v1/auth/switch-tenant", {
      method: "POST",
      token,
      body: JSON.stringify({ tenantId }),
    });
    const tenantToken = switched.body.accessToken as string;
    const project = await json(`/v1/tenants/${tenantId}/projects`, {
      method: "POST",
      token: tenantToken,
      body: JSON.stringify({ key: "EXT", name: "External" }),
    });
    expect(project.res.status).toBe(201);

    const instanceId = newId();
    await db.insert(runtimeInstances).values({
      id: instanceId,
      tenantId,
      name: "external-oc",
      mode: "external",
      runtimeType: "opencode",
      baseUrl: "http://127.0.0.1:9",
      hasSyncAgent: true,
      healthStatus: "healthy",
      isolation: "dedicated",
    });
    await db.insert(workspaces).values({
      id: newId(),
      tenantId,
      projectId: project.body.id,
      ownerUserId: userId,
      kind: "personal",
      runtimeType: "opencode",
      instanceId,
      status: "ready",
      spec: {},
    });

    const created = await json(`/v1/projects/${project.body.id}/bundles`, {
      method: "POST",
      token: tenantToken,
      body: JSON.stringify({ name: "project" }),
    });
    const bundleId = created.body.id as string;
    const saved = await json(`/v1/bundles/${bundleId}/draft`, {
      method: "PUT",
      token: tenantToken,
      headers: { "if-match": created.body.etag },
      body: JSON.stringify({
        agents: [{ name: "build", description: "Build", prompt: "from sync" }],
        mcp: [],
        skills: [],
        instructions: { agentsMd: "Synced instructions." },
      }),
    });
    expect(saved.res.status).toBe(200);
    const published = await json(`/v1/bundles/${bundleId}/publish`, {
      method: "POST",
      token: tenantToken,
      headers: { "idempotency-key": "publish-ext" },
      body: "{}",
    });
    expect(published.res.status).toBe(201);
    const applied = await json(`/v1/projects/${project.body.id}/config/apply`, {
      method: "POST",
      token: tenantToken,
      headers: { "idempotency-key": "apply-ext" },
      body: "{}",
    });
    expect(applied.body.jobs[0].status).toBe("running");

    const issued = await json(`/v1/instances/${instanceId}/sync-token`, {
      method: "POST",
      token: tenantToken,
    });
    expect(issued.res.status).toBe(200);
    const workdir = await mkdtemp(join(tmpdir(), "ah-ext-"));
    await writeFile(join(workdir, "notes.txt"), "remote user");
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      return app.request(`${url.pathname}${url.search}`, init);
    };
    const result = await syncOnce({
      hubUrl: "http://hub.test",
      token: issued.body.token,
      workdir,
      publicKey: syncPublicKey(),
      fetchImpl,
    });
    expect(result.applied).toBe(1);
    expect(await readFile(join(workdir, "AGENTS.md"), "utf8")).toContain("Synced instructions.");
    expect(await readFile(join(workdir, ".opencode/agents/build.md"), "utf8")).toContain("from sync");
    expect(await readFile(join(workdir, "notes.txt"), "utf8")).toBe("remote user");

    const jobs = await json(`/v1/projects/${project.body.id}/apply-jobs`, { token: tenantToken });
    expect(jobs.body.items[0].status).toBe("succeeded");
  });
});
