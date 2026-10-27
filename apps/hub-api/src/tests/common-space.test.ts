import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, workspaces } from "@agenthub/db";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { createApp } from "../app.js";
import { newId } from "../lib/id.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://agenthub:agenthub@localhost:5432/agenthub";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

function zipStored(files: { name: string; data: Buffer; symlink?: boolean }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const chunk = Buffer.concat([local, name, file.data]);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(file.symlink ? (3 << 8) | 20 : 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    if (file.symlink) central.writeUInt32LE((0o120000 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(chunk);
    centrals.push(central);
    offset += chunk.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

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

describe("P1-05 common space", () => {
  const applyRoot = join(tmpdir(), `ah-common-apply-${Date.now()}`);
  const commonRoot = join(tmpdir(), `ah-common-objects-${Date.now()}`);
  const db = createDb(DATABASE_URL);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  const { app } = createApp({
    db,
    redis,
    envOverrides: {
      APPLY_ROOT: applyRoot,
      COMMON_ROOT: commonRoot,
      S3_ENDPOINT: undefined,
      S3_ACCESS_KEY: undefined,
      S3_SECRET_KEY: undefined,
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
    if (init.body && !headers.has("content-type") && typeof init.body === "string") {
      headers.set("content-type", "application/json");
    }
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    const res = await app.request(path, { ...init, headers });
    const text = await res.text();
    return { res, body: text ? JSON.parse(text) : null };
  }

  it("uploads docs/spec.md, syncs a read-only tree, and keeps protected prefixes owner-only", async () => {
    const register = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "common-owner@example.com",
        password: "password-common-1",
        displayName: "Common Owner",
        handle: "common-owner",
      }),
    });
    expect(register.res.status).toBe(201);
    await db.execute(sql`UPDATE users SET is_platform_admin = true WHERE email = 'common-owner@example.com'`);
    const login = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "common-owner@example.com", password: "password-common-1" }),
    });
    const ownerToken = login.body.accessToken as string;
    const ownerId = login.body.user.id as string;

    const devReg = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "common-dev@example.com",
        password: "password-common-1",
        displayName: "Common Dev",
        handle: "common-dev",
      }),
    });
    expect(devReg.res.status).toBe(201);
    const devLogin = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "common-dev@example.com", password: "password-common-1" }),
    });
    const devToken = devLogin.body.accessToken as string;

    const viewerReg = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "common-viewer@example.com",
        password: "password-common-1",
        displayName: "Common Viewer",
        handle: "common-viewer",
      }),
    });
    expect(viewerReg.res.status).toBe(201);
    const viewerLogin = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "common-viewer@example.com", password: "password-common-1" }),
    });
    const viewerToken = viewerLogin.body.accessToken as string;

    const tenant = await json("/v1/admin/tenants", {
      method: "POST",
      token: ownerToken,
      body: JSON.stringify({
        slug: "common-co",
        name: "Common Co",
        ownerEmail: "common-owner@example.com",
      }),
    });
    expect(tenant.res.status).toBe(201);
    const switched = await json("/v1/auth/switch-tenant", {
      method: "POST",
      token: ownerToken,
      body: JSON.stringify({ tenantId: tenant.body.id }),
    });
    const ownerTenantToken = switched.body.accessToken as string;
    const project = await json(`/v1/tenants/${tenant.body.id}/projects`, {
      method: "POST",
      token: ownerTenantToken,
      body: JSON.stringify({ key: "COM", name: "Common Project" }),
    });
    expect(project.res.status).toBe(201);
    const projectId = project.body.id as string;

    for (const [email, role] of [
      ["common-dev@example.com", "developer"],
      ["common-viewer@example.com", "viewer"],
    ] as const) {
      const invite = await json(`/v1/tenants/${tenant.body.id}/invitations`, {
        method: "POST",
        token: ownerTenantToken,
        body: JSON.stringify({
          email,
          tenantRole: "member",
          projectGrants: [{ projectId, role }],
        }),
      });
      expect(invite.res.status).toBe(201);
    }

    const viewerTree = await json(`/v1/projects/${projectId}/common/tree`, { token: viewerToken });
    expect(viewerTree.res.status).toBe(200);
    const viewerUpload = new FormData();
    viewerUpload.set("prefix", "fixtures");
    viewerUpload.append("files", new File(["nope"], "note.txt", { type: "text/plain" }));
    const viewerWrite = await app.request(`/v1/projects/${projectId}/common/upload`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${viewerToken}`,
        "idempotency-key": "viewer-upload-01",
      },
      body: viewerUpload,
    });
    expect(viewerWrite.status).toBe(403);

    const badDir = await json(`/v1/projects/${projectId}/common/dirs`, {
      method: "POST",
      token: devToken,
      body: JSON.stringify({ path: "../secret" }),
    });
    expect(badDir.res.status).toBe(400);
    expect(badDir.body.error.code).toBe("INVALID_PATH");

    const devUpload = new FormData();
    devUpload.set("prefix", "fixtures");
    devUpload.append("files", new File(["fixture"], "note.txt", { type: "text/plain" }));
    const uploaded = await app.request(`/v1/projects/${projectId}/common/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${devToken}`, "idempotency-key": "dev-upload-0001" },
      body: devUpload,
    });
    expect(uploaded.status).toBe(201);

    const tinyQuota = await json(`/v1/projects/${projectId}/common/settings`, {
      method: "PUT",
      token: ownerTenantToken,
        body: JSON.stringify({ quotaBytes: 8 }),
    });
    expect(tinyQuota.res.status).toBe(200);
    const tooBig = await json(`/v1/projects/${projectId}/common/files/fixtures/big.txt`, {
      method: "PUT",
      token: devToken,
      headers: { "content-type": "text/plain" },
      body: "12345",
    });
    expect(tooBig.res.status).toBe(413);
    const restoreQuota = await json(`/v1/projects/${projectId}/common/settings`, {
      method: "PUT",
      token: ownerTenantToken,
      body: JSON.stringify({
        quotaBytes: 5_368_709_120,
        protectedPrefixes: ["docs"],
        syncPolicy: "on_workspace_start",
      }),
    });
    expect(restoreQuota.res.status).toBe(200);

    const denied = await json(`/v1/projects/${projectId}/common/files/docs/spec.md`, {
      method: "PUT",
      token: devToken,
      headers: { "content-type": "text/markdown" },
      body: "# nope\n",
    });
    expect(denied.res.status).toBe(403);
    expect(denied.body.error.code).toBe("PROTECTED_PATH");

    const spec = await json(`/v1/projects/${projectId}/common/files/docs/spec.md`, {
      method: "PUT",
      token: ownerTenantToken,
      headers: { "content-type": "text/markdown" },
      body: "# spec\n",
    });
    expect(spec.res.status).toBe(200);
    expect(spec.body.path).toBe("docs/spec.md");
    expect(spec.body.protected).toBe(true);

    const zip = zipStored([
      { name: "from-zip.txt", data: Buffer.from("zipped\n") },
      { name: "link.txt", data: Buffer.from("target"), symlink: true },
    ]);
    const zipForm = new FormData();
    zipForm.set("prefix", "fixtures");
    zipForm.set("file", new File([zip], "pack.zip", { type: "application/zip" }));
    const zipped = await app.request(`/v1/projects/${projectId}/common/upload-zip`, {
      method: "POST",
      headers: { authorization: `Bearer ${devToken}`, "idempotency-key": "dev-zip-000001" },
      body: zipForm,
    });
    expect(zipped.status).toBe(201);
    const zipBody = (await zipped.json()) as { created: number; skipped: { reason: string }[] };
    expect(zipBody.created).toBe(1);
    expect(zipBody.skipped.some((item) => item.reason === "symlink")).toBe(true);

    const tree = await json(`/v1/projects/${projectId}/common/tree?prefix=docs&depth=1`, {
      token: viewerToken,
    });
    expect(tree.res.status).toBe(200);
    expect(tree.body.entries.some((entry: { path: string }) => entry.path === "docs/spec.md")).toBe(true);
    expect(tree.body.canWrite).toBe(false);

    const preview = await app.request(`/v1/projects/${projectId}/common/files/docs/spec.md`, {
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("etag")).toBeTruthy();
    expect(await preview.text()).toBe("# spec\n");

    const volume = await mkdtemp(join(tmpdir(), "ah-common-ws-"));
    const workspaceId = newId();
    await db.insert(workspaces).values({
      id: workspaceId,
      tenantId: tenant.body.id,
      projectId,
      ownerUserId: ownerId,
      kind: "personal",
      runtimeType: "opencode",
      status: "ready",
      volumePath: volume,
      spec: {},
    });

    const synced = await json(`/v1/workspaces/${workspaceId}/sync-common`, {
      method: "POST",
      token: ownerTenantToken,
      headers: { "idempotency-key": "sync-common-001" },
    });
    expect(synced.res.status).toBe(200);
    expect(synced.body.status).toBe("succeeded");
    const specPath = join(volume, "project-common", "docs", "spec.md");
    expect(await readFile(specPath, "utf8")).toBe("# spec\n");
    await expect(writeFile(specPath, "changed")).rejects.toThrow();
    await expect(writeFile(join(volume, "project-common", "docs", "other.md"), "x")).rejects.toThrow();

    const again = await json(`/v1/workspaces/${workspaceId}/sync-common`, {
      method: "POST",
      token: ownerTenantToken,
      headers: { "idempotency-key": "sync-common-002" },
    });
    expect(again.body.status).toBe("skipped");

    const viewerSync = await json(`/v1/workspaces/${workspaceId}/sync-common`, {
      method: "POST",
      token: viewerToken,
      headers: { "idempotency-key": "sync-common-003" },
    });
    expect(viewerSync.res.status).toBe(403);
  });
});
