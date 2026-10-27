import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import {
  applyJobs,
  credentialVersions,
  jobsOutbox,
  projectCredentials,
  runtimeInstances,
  workspaces,
} from "@agenthub/db";
import { can } from "@agenthub/auth";
import type { ApplyJob, Manifest, SecretRef } from "@agenthub/domain";
import {
  applyManagedTree,
  isSecretRef,
  renderBundle,
  sha256Buffer,
  walkSecrets,
  type RenderedTree,
} from "@agenthub/config-bundle";
import { AppError, forbidden, notFound } from "../errors.js";
import { decryptSecret } from "../lib/crypto.js";
import { newId } from "../lib/id.js";
import { logger } from "../lib/logger.js";
import {
  payloadQueryMatches,
  signPayloadQuery,
  signSyncPayload,
} from "../lib/sync-crypto.js";
import { toIso } from "../lib/time.js";
import { resolveProjectAccess } from "./projects.js";
import { readBlob, resolveEffectiveConfig } from "./config-bundles.js";

export type ApplyEnv = {
  applyRoot: string;
  blobRoot: string;
  platformDek: string;
  runtimeMock: boolean;
  publicBaseUrl: string;
  syncTokenSecret: string;
  syncPrivateKey?: string;
};

type Actor = { userId: string; isPlatformAdmin: boolean };
type Trigger = ApplyJob["trigger"];

type StoredDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  channels?: { file: string; api: string };
  expected?: Record<string, string>;
};

function mapJob(row: typeof applyJobs.$inferSelect): ApplyJob {
  const diff = (row.diffSummary ?? null) as StoredDiff | null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind as ApplyJob["kind"],
    targetHash: row.targetHash,
    trigger: row.trigger as ApplyJob["trigger"],
    status: row.status as ApplyJob["status"],
    ...(diff
      ? {
          diffSummary: {
            added: diff.added ?? [],
            removed: diff.removed ?? [],
            changed: diff.changed ?? [],
          },
        }
      : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.startedAt ? { startedAt: toIso(row.startedAt)! } : {}),
    ...(row.finishedAt ? { finishedAt: toIso(row.finishedAt)! } : {}),
  };
}

async function loadBlobs(blobRoot: string, manifest: Manifest) {
  const blobs: Record<string, Buffer> = {};
  for (const skill of manifest.skills) {
    for (const file of skill.files) {
      if (!blobs[file.sha256]) blobs[file.sha256] = await readBlob(blobRoot, file.sha256);
    }
  }
  return blobs;
}

async function secretMap(db: Db, projectId: string, manifest: Manifest, platformDek: string) {
  const ids = new Set<string>();
  const walk = (value: unknown) => {
    if (isSecretRef(value) && value.$secret.kind === "projectCredential") ids.add(value.$secret.id);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };
  walk(manifest.mcp);
  const resolved = new Map<string, string>();
  for (const id of ids) {
    const [cred] = await db
      .select()
      .from(projectCredentials)
      .where(and(eq(projectCredentials.id, id), eq(projectCredentials.projectId, projectId)))
      .limit(1);
    if (!cred || cred.status !== "active") {
      throw new AppError(400, "VALIDATION_FAILED", "项目凭据无法解析");
    }
    const [version] = await db
      .select()
      .from(credentialVersions)
      .where(
        and(
          eq(credentialVersions.credentialKind, "project"),
          eq(credentialVersions.credentialId, id),
          eq(credentialVersions.version, cred.currentVersion),
        ),
      )
      .limit(1);
    if (!version || version.revokedAt) {
      throw new AppError(400, "VALIDATION_FAILED", "项目凭据无法解析");
    }
    resolved.set(id, decryptSecret(Buffer.from(version.secretCiphertext), platformDek));
  }
  return (ref: SecretRef) => {
    if (ref.$secret.kind !== "projectCredential") {
      throw new AppError(400, "VALIDATION_FAILED", "vault secret 未配置");
    }
    const value = resolved.get(ref.$secret.id);
    if (!value) throw new AppError(400, "VALIDATION_FAILED", "项目凭据无法解析");
    return value;
  };
}

function localRoot(
  workspace: { id: string; volumePath: string | null },
  instance: { mode: string; baseUrl: string } | null,
  applyRoot: string,
) {
  if (instance?.mode === "external" && !instance.baseUrl.startsWith("mock://")) return null;
  if (workspace.volumePath) return workspace.volumePath;
  return join(applyRoot, workspace.id);
}

async function pushApi(
  baseUrl: string,
  tree: RenderedTree,
  resolve: (ref: SecretRef) => string,
  authHeader?: string,
) {
  for (const op of tree.apiOps) {
    const body = walkSecrets(op, resolve);
    const path = op.op === "mcp.add" ? "/mcp" : "/config";
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: op.op === "mcp.add" ? "POST" : "PATCH",
      headers: {
        "content-type": "application/json",
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`runtime api ${res.status}`);
  }
}

async function finishJob(
  db: Db,
  job: typeof applyJobs.$inferSelect,
  input: {
    status: ApplyJob["status"];
    error?: string;
    diff: StoredDiff;
    channel: "api" | "file" | "both";
    hash?: string;
  },
) {
  const now = new Date();
  await db
    .update(applyJobs)
    .set({
      status: input.status,
      error: input.error ?? null,
      diffSummary: input.diff,
      channel: input.channel,
      finishedAt: input.status === "running" ? null : now,
      startedAt: job.startedAt ?? now,
    })
    .where(eq(applyJobs.id, job.id));

  if (input.status === "succeeded" && input.hash) {
    await db
      .update(workspaces)
      .set({
        status: "ready",
        statusReason: null,
        appliedRevisionHash: input.hash,
        updatedAt: now,
      })
      .where(eq(workspaces.id, job.workspaceId));
  } else if (input.status === "failed" || input.status === "partial") {
    await db
      .update(workspaces)
      .set({
        status: "ready_degraded",
        statusReason: input.error ?? input.status,
        updatedAt: now,
      })
      .where(eq(workspaces.id, job.workspaceId));
    logger.warn(
      { jobId: job.id, workspaceId: job.workspaceId, status: input.status, error: input.error },
      "config apply needs attention",
    );
  } else if (input.status === "running") {
    await db
      .update(workspaces)
      .set({ status: "applying", statusReason: "waiting for agenthub-sync", updatedAt: now })
      .where(eq(workspaces.id, job.workspaceId));
  }

  const [updated] = await db.select().from(applyJobs).where(eq(applyJobs.id, job.id)).limit(1);
  return mapJob(updated!);
}

async function executeJob(
  db: Db,
  job: typeof applyJobs.$inferSelect,
  workspace: typeof workspaces.$inferSelect,
  manifest: Manifest,
  env: ApplyEnv,
) {
  const instance = workspace.instanceId
    ? (
        await db
          .select()
          .from(runtimeInstances)
          .where(eq(runtimeInstances.id, workspace.instanceId))
          .limit(1)
      )[0] ?? null
    : null;
  const root = localRoot(workspace, instance, env.applyRoot);
  let existingConfig: string | undefined;
  if (root) {
    try {
      existingConfig = await readFile(join(root, "opencode.json"), "utf8");
    } catch {
      existingConfig = undefined;
    }
  }
  const tree = renderBundle({
    manifest,
    runtimeType: workspace.runtimeType === "claude" ? "claude" : "opencode",
    blobs: await loadBlobs(env.blobRoot, manifest),
    ...(existingConfig ? { existingFiles: { "opencode.json": existingConfig } } : {}),
  });
  const resolve = await secretMap(db, workspace.projectId, manifest, env.platformDek);

  let file: "ok" | "skipped" | "pending" | "failed" = "skipped";
  let api: "ok" | "skipped" | "failed" = "skipped";
  let diff: StoredDiff = { added: [], removed: [], changed: [], expected: tree.manifest };
  let error: string | undefined;
  let retryable = false;

  if (root) {
    const written = await applyManagedTree(root, tree.files);
    for (const fileItem of tree.files) {
      const onDisk = await readFile(join(root, fileItem.path));
      if (sha256Buffer(onDisk) !== fileItem.sha256) {
        file = "failed";
        error = "文件校验失败：写入内容与清单不一致";
      }
    }
    if (file !== "failed") {
      file = "ok";
      diff = { ...diff, added: written.added, removed: written.removed, changed: written.changed };
    }
  } else if (instance?.mode === "external" && instance.hasSyncAgent) {
    const payload = {
      files: tree.files.map((item) => ({
        path: item.path,
        sha256: item.sha256,
        contentBase64: item.content.toString("base64"),
      })),
    };
    const dir = join(env.applyRoot, "payloads");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${job.id}.json`), JSON.stringify(payload));
    file = "pending";
    diff.expected = tree.manifest;
  } else {
    file = "skipped";
    error = "agenthub-sync 未连接，文件通道已跳过";
  }

  if (file !== "failed" && instance && tree.apiOps.length > 0) {
    if (instance.baseUrl.startsWith("mock://")) {
      walkSecrets(tree.apiOps, resolve);
      api = "ok";
    } else {
      try {
        const header =
          instance.authUsername && instance.authSecretCiphertext
            ? `Basic ${Buffer.from(
                `${instance.authUsername}:${decryptSecret(Buffer.from(instance.authSecretCiphertext), env.platformDek)}`,
              ).toString("base64")}`
            : undefined;
        await pushApi(instance.baseUrl, tree, resolve, header);
        api = "ok";
      } catch (err) {
        if (env.runtimeMock) {
          api = "ok";
        } else {
          api = "failed";
          retryable = true;
          error = "运行时 API 通道失败";
          logger.warn(
            { jobId: job.id, message: err instanceof Error ? err.message : "api failed" },
            "config apply api channel failed",
          );
        }
      }
    }
  }

  const channel: "api" | "file" | "both" =
    file !== "skipped" && api !== "skipped" ? "both" : api !== "skipped" ? "api" : "file";
  diff.channels = { file, api };

  let status: ApplyJob["status"] = "failed";
  if (file === "failed" || api === "failed") status = "failed";
  else if (file === "pending") status = "running";
  else if (file === "skipped") status = "partial";
  else status = "succeeded";

  if (status === "succeeded") error = undefined;
  const saved = await finishJob(db, job, {
    status,
    error,
    diff,
    channel,
    hash: status === "succeeded" ? job.targetHash : undefined,
  });
  return { job: saved, retryable: retryable && status === "failed" };
}

export async function applyProjectConfig(
  db: Db,
  projectId: string,
  actor: Actor,
  env: ApplyEnv,
  input: { workspaceIds?: string[]; trigger: Trigger },
) {
  const resolved = await resolveProjectAccess(db, projectId, actor.userId, actor.isPlatformAdmin);
  if (
    !can(resolved.projectRole, resolved.tenantRole, "config.apply", {
      isPlatformAdmin: actor.isPlatformAdmin,
    })
  ) {
    throw forbidden();
  }
  const rows = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.projectId, projectId),
        notInArray(workspaces.status, ["deleted", "revoked"]),
      ),
    );
  const targets = input.workspaceIds
    ? rows.filter((row) => input.workspaceIds!.includes(row.id))
    : rows;
  if (input.workspaceIds && targets.length !== input.workspaceIds.length) {
    throw notFound("Workspace not found");
  }
  if (targets.length > 100) {
    throw new AppError(400, "VALIDATION_FAILED", "一次最多下发 100 个工作区");
  }

  const created: ApplyJob[] = [];
  for (const workspace of targets) {
    const effective = await resolveEffectiveConfig(db, projectId, actor, workspace.ownerUserId);
    if (workspace.appliedRevisionHash === effective.hash) continue;
    const id = newId();
    await db.transaction(async (tx) => {
      await tx.insert(applyJobs).values({
        id,
        tenantId: workspace.tenantId,
        workspaceId: workspace.id,
        instanceId: workspace.instanceId,
        kind: "config",
        targetHash: effective.hash,
        trigger: input.trigger,
        status: "queued",
        requestedBy: actor.userId,
      });
      await tx.insert(jobsOutbox).values({
        id,
        tenantId: workspace.tenantId,
        jobType: "apply",
        payload: { applyJobId: id, workspaceId: workspace.id, targetHash: effective.hash },
        status: "pending",
      });
    });
    await db
      .update(jobsOutbox)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(jobsOutbox.id, id));

    let last: ApplyJob | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const [job] = await db
        .update(applyJobs)
        .set({ status: "running", attempts: attempt, startedAt: new Date() })
        .where(eq(applyJobs.id, id))
        .returning();
      try {
        const result = await executeJob(db, job!, workspace, effective.manifest, env);
        last = result.job;
        if (!result.retryable || result.job.status !== "failed") break;
      } catch (err) {
        const message = err instanceof AppError ? err.message : "配置下发失败";
        if (!(err instanceof AppError)) {
          logger.warn({ err, jobId: id }, "config apply failed");
        }
        last = await finishJob(db, job!, {
          status: "failed",
          error: message,
          diff: { added: [], removed: [], changed: [] },
          channel: "file",
        });
        if (err instanceof AppError || attempt === 3) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
    if (last) created.push(last);
  }
  return { jobs: created };
}

export async function listApplyJobs(
  db: Db,
  projectId: string,
  actor: Actor,
  filter: { workspaceId?: string; status?: string },
) {
  await resolveEffectiveConfig(db, projectId, actor);
  const workspaceRows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.projectId, projectId));
  const ids = workspaceRows.map((row) => row.id);
  if (ids.length === 0) return { items: [], nextCursor: null };
  const filters = [inArray(applyJobs.workspaceId, ids)];
  if (filter.workspaceId) filters.push(eq(applyJobs.workspaceId, filter.workspaceId));
  if (filter.status) filters.push(eq(applyJobs.status, filter.status));
  const rows = await db
    .select()
    .from(applyJobs)
    .where(and(...filters))
    .orderBy(desc(applyJobs.createdAt))
    .limit(50);
  return { items: rows.map(mapJob), nextCursor: null };
}

export async function listSyncTasks(db: Db, instanceId: string, env: ApplyEnv, waitSec: number) {
  const read = async () => {
    const rows = await db
      .select()
      .from(applyJobs)
      .where(and(eq(applyJobs.instanceId, instanceId), eq(applyJobs.status, "running")));
    const tasks = [];
    for (const row of rows) {
      const diff = (row.diffSummary ?? {}) as StoredDiff;
      if (diff.channels?.file !== "pending" || !diff.expected) continue;
      const exp = Math.floor(Date.now() / 1000) + 10 * 60;
      const sig = signPayloadQuery(row.id, exp, env.syncTokenSecret);
      const url = `${env.publicBaseUrl.replace(/\/$/, "")}/v1/sync/payloads/${row.id}?exp=${exp}&sig=${sig}`;
      const body = { id: row.id, type: "apply" as const, manifest: diff.expected, urls: [url] };
      tasks.push({ ...body, signature: signSyncPayload(body, env.syncPrivateKey) });
    }
    return tasks;
  };
  const first = await read();
  if (first.length > 0 || waitSec <= 0) return { tasks: first };
  const deadline = Date.now() + waitSec * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const again = await read();
    if (again.length > 0) return { tasks: again };
  }
  return { tasks: [] };
}

export async function readSyncPayload(
  db: Db,
  jobId: string,
  instanceId: string,
  env: ApplyEnv,
  exp: number,
  sig: string,
) {
  if (!payloadQueryMatches(jobId, exp, sig, env.syncTokenSecret) || exp < Date.now() / 1000) {
    throw forbidden("签名 URL 无效或已过期");
  }
  const [job] = await db.select().from(applyJobs).where(eq(applyJobs.id, jobId)).limit(1);
  if (!job || job.instanceId !== instanceId) throw notFound("Sync task not found");
  const raw = await readFile(join(env.applyRoot, "payloads", `${jobId}.json`), "utf8");
  return JSON.parse(raw) as {
    files: { path: string; sha256: string; contentBase64: string }[];
  };
}

export async function completeSyncTask(
  db: Db,
  jobId: string,
  instanceId: string,
  body: {
    status: "succeeded" | "failed";
    manifest?: Record<string, string>;
    error?: string;
    added?: string[];
    removed?: string[];
    changed?: string[];
  },
) {
  const [job] = await db.select().from(applyJobs).where(eq(applyJobs.id, jobId)).limit(1);
  if (!job || job.instanceId !== instanceId) throw notFound("Sync task not found");
  const diff = (job.diffSummary ?? { added: [], removed: [], changed: [] }) as StoredDiff;
  if (body.status === "failed") {
    return finishJob(db, job, {
      status: "failed",
      error: body.error ?? "agenthub-sync 写入失败",
      diff,
      channel: job.channel === "both" || job.channel === "api" ? "both" : "file",
    });
  }
  const expected = diff.expected ?? {};
  const reported = body.manifest ?? {};
  const missing = Object.entries(expected).filter(([path, sha]) => reported[path] !== sha);
  if (missing.length > 0) {
    return finishJob(db, job, {
      status: "failed",
      error: "文件校验失败：清单与工作区不一致",
      diff,
      channel: "file",
    });
  }
  const api = diff.channels?.api ?? "skipped";
  const status = api === "failed" ? "failed" : "succeeded";
  return finishJob(db, job, {
    status,
    error: status === "failed" ? "运行时 API 通道失败" : undefined,
    diff: {
      ...diff,
      added: body.added ?? diff.added,
      removed: body.removed ?? diff.removed,
      changed: body.changed ?? diff.changed,
      channels: { file: "ok", api },
    },
    channel: api === "skipped" ? "file" : "both",
    hash: status === "succeeded" ? job.targetHash : undefined,
  });
}
