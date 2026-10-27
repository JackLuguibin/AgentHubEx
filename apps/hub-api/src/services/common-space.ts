import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import {
  applyJobs,
  commonFileVersions,
  commonFiles,
  commonProtectedPrefixes,
  jobsOutbox,
  projects,
  runtimeInstances,
  users,
  workspaces,
} from "@agenthub/db";
import { can } from "@agenthub/auth";
import type { ApplyJob, CommonEntry, CommonSettings, CommonTree } from "@agenthub/domain";
import {
  CommonFsError,
  LIMITS,
  assertQuota,
  assertWritable,
  canonicalizePath,
  isProtectedPath,
  joinPrefix,
  materializeCommonTree,
  normalizeMime,
  objectKey,
  sha256Buffer,
  snapshotHash,
} from "@agenthub/common-fs";
import { AppError, conflict, forbidden, notFound } from "../errors.js";
import { recordAudit } from "../lib/audit.js";
import { newId } from "../lib/id.js";
import { logger } from "../lib/logger.js";
import type { ObjectStore } from "../lib/object-store.js";
import { toIso } from "../lib/time.js";
import { unzipStored } from "../lib/zip.js";
import { getProjectRow, resolveProjectAccess } from "./projects.js";
import { assertTenantActive } from "./tenants.js";

type Actor = { userId: string; isPlatformAdmin: boolean };
type Trigger = ApplyJob["trigger"];
type Query = Db;

export type CommonSyncEnv = { applyRoot: string };

type FileRow = typeof commonFiles.$inferSelect;

function mapFs(err: unknown): AppError | null {
  if (!(err instanceof CommonFsError)) return null;
  if (err.code === "PROTECTED_PATH") return new AppError(403, "PROTECTED_PATH", err.message);
  if (err.code === "QUOTA_EXCEEDED") return new AppError(413, "QUOTA_EXCEEDED", err.message);
  if (err.code === "INVALID_MIME") return new AppError(400, "VALIDATION_FAILED", err.message);
  return new AppError(400, "INVALID_PATH", err.message);
}

function unwrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    const mapped = mapFs(err);
    if (mapped) throw mapped;
    throw err;
  }
}

function guardWrite(
  opened: { row: { tenantId: string }; prefixes: string[]; allowProtected: boolean },
  actor: Actor,
  projectId: string,
  raw: string,
) {
  try {
    return unwrap(() => assertWritable(raw, opened.prefixes, opened.allowProtected));
  } catch (err) {
    if (err instanceof AppError && err.code === "PROTECTED_PATH") {
      recordAudit({
        action: "common.protected_denied",
        actorId: actor.userId,
        tenantId: opened.row.tenantId,
        projectId,
        targetType: "common_file",
        targetId: raw,
        meta: { path: raw, protectedPrefixes: opened.prefixes },
      });
    }
    throw err;
  }
}

function auditProtectedWrite(
  opened: { row: { tenantId: string }; prefixes: string[] },
  actor: Actor,
  projectId: string,
  path: string,
) {
  if (!isProtectedPath(path, opened.prefixes)) return;
  recordAudit({
    action: "common.protected_write",
    actorId: actor.userId,
    tenantId: opened.row.tenantId,
    projectId,
    targetType: "common_file",
    targetId: path,
    meta: { path, protectedPrefixes: opened.prefixes },
  });
}

async function txn<T>(db: Db, fn: (tx: Query) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx as unknown as Query));
}

function matchTag(header: string | null | undefined) {
  if (!header) return null;
  const tag = header.trim().replace(/^W\//, "").replaceAll('"', "");
  return tag || null;
}

function nameOf(path: string) {
  return path.split("/").at(-1) ?? path;
}

function toEntry(row: FileRow, displayName: string, prefixes: string[]): CommonEntry {
  return {
    path: row.path,
    name: nameOf(row.path),
    isDir: row.isDir,
    size: Number(row.size),
    ...(row.mime ? { mime: row.mime } : {}),
    ...(row.checksum ? { checksum: row.checksum } : {}),
    version: row.currentVersion,
    protected: unwrap(() => isProtectedPath(row.path, prefixes)),
    updatedBy: { id: row.uploadedBy, displayName },
    updatedAt: toIso(row.updatedAt)!,
  };
}

async function loadPrefixes(db: Query, projectId: string) {
  const rows = await db
    .select()
    .from(commonProtectedPrefixes)
    .where(eq(commonProtectedPrefixes.projectId, projectId));
  return rows.map((row) => row.prefix);
}

async function openProject(db: Db, projectId: string, actor: Actor, mode: "read" | "write" | "protected") {
  const resolved = await resolveProjectAccess(db, projectId, actor.userId, actor.isPlatformAdmin);
  const perm =
    mode === "read" ? "common.read" : mode === "protected" ? "common.write_protected" : "common.write";
  if (
    !can(resolved.projectRole, resolved.tenantRole, perm, { isPlatformAdmin: actor.isPlatformAdmin })
  ) {
    throw forbidden();
  }
  if (mode !== "read") {
    if (resolved.project.archivedAt) {
      throw conflict("Project is archived", undefined, "PROJECT_ARCHIVED");
    }
    await assertTenantActive(db, resolved.project.tenantId);
  }
  const row = await getProjectRow(db, projectId);
  const usedBytes = Number(row.commonUsedBytes);
  const quotaBytes = Number(row.commonQuotaBytes);
  const prefixes = await loadPrefixes(db, projectId);
  const allowProtected = can(
    resolved.projectRole,
    resolved.tenantRole,
    "common.write_protected",
    { isPlatformAdmin: actor.isPlatformAdmin },
  );
  const canWrite = can(resolved.projectRole, resolved.tenantRole, "common.write", {
    isPlatformAdmin: actor.isPlatformAdmin,
  });
  return { resolved, row, prefixes, allowProtected, canWrite, usedBytes, quotaBytes };
}

async function findActive(db: Query, projectId: string, path: string) {
  const [row] = await db
    .select()
    .from(commonFiles)
    .where(
      and(eq(commonFiles.projectId, projectId), eq(commonFiles.path, path), isNull(commonFiles.deletedAt)),
    )
    .limit(1);
  return row ?? null;
}

async function loadLive(db: Query, projectId: string) {
  return db
    .select({ file: commonFiles, displayName: users.displayName })
    .from(commonFiles)
    .innerJoin(users, eq(users.id, commonFiles.uploadedBy))
    .where(and(eq(commonFiles.projectId, projectId), isNull(commonFiles.deletedAt)));
}

function depthOf(path: string, prefix: string) {
  if (!prefix) return path.split("/").length;
  if (path === prefix || !path.startsWith(`${prefix}/`)) return null;
  return path.slice(prefix.length + 1).split("/").length;
}

async function adjustUsage(tx: Query, projectId: string, delta: number) {
  if (delta === 0) return;
  const updated = await tx
    .update(projects)
    .set({
      commonUsedBytes: sql`${projects.commonUsedBytes} + ${delta}`,
    })
    .where(
      and(
        eq(projects.id, projectId),
        sql`${projects.commonUsedBytes} + ${delta} <= ${projects.commonQuotaBytes}`,
        sql`${projects.commonUsedBytes} + ${delta} >= 0`,
      ),
    )
    .returning({ used: projects.commonUsedBytes });
  if (updated.length === 0) {
    throw new AppError(413, "QUOTA_EXCEEDED", "公共空间配额不足");
  }
}

async function ensureParents(tx: Query, tenantId: string, projectId: string, path: string, userId: string) {
  const parts = path.split("/");
  parts.pop();
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    const existing = await findActive(tx, projectId, acc);
    if (existing?.isDir) continue;
    if (existing) throw conflict("路径与已有文件冲突");
    await tx.insert(commonFiles).values({
      id: newId(),
      tenantId,
      projectId,
      path: acc,
      isDir: true,
      size: 0,
      currentVersion: 0,
      uploadedBy: userId,
    });
  }
}

async function entryByPath(db: Query, projectId: string, path: string, prefixes: string[]) {
  const rows = await loadLive(db, projectId);
  const hit = rows.find((row) => row.file.path === path);
  if (!hit) throw notFound("File not found");
  return toEntry(hit.file, hit.displayName, prefixes);
}

export async function listCommonTree(
  db: Db,
  projectId: string,
  actor: Actor,
  prefixRaw: string,
  depth: number,
): Promise<CommonTree> {
  const { prefixes, allowProtected, canWrite, usedBytes, quotaBytes, row } = await openProject(
    db,
    projectId,
    actor,
    "read",
  );
  const prefix = prefixRaw ? unwrap(() => canonicalizePath(prefixRaw)) : "";
  const rows = await loadLive(db, projectId);
  const entries = rows
    .filter((item) => {
      const rel = depthOf(item.file.path, prefix);
      return rel != null && rel > 0 && rel <= depth;
    })
    .map((item) => toEntry(item.file, item.displayName, prefixes))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return {
    entries,
    usedBytes,
    quotaBytes,
    syncPolicy: row.commonSyncPolicy as CommonTree["syncPolicy"],
    protectedPrefixes: prefixes,
    canWrite,
    canWriteProtected: allowProtected,
  };
}

export async function readCommonFile(
  db: Db,
  store: ObjectStore,
  projectId: string,
  actor: Actor,
  rawPath: string,
  version: number | null,
) {
  const { prefixes } = await openProject(db, projectId, actor, "read");
  const path = unwrap(() => canonicalizePath(rawPath));
  const row = await findActive(db, projectId, path);
  if (!row || row.isDir) throw notFound("File not found");
  const wanted = version ?? row.currentVersion;
  const [stored] = await db
    .select()
    .from(commonFileVersions)
    .where(and(eq(commonFileVersions.fileId, row.id), eq(commonFileVersions.version, wanted)))
    .limit(1);
  if (!stored) throw notFound("File version not found");
  const body = await store.get(stored.objectKey);
  return {
    body,
    mime: row.mime ?? "application/octet-stream",
    checksum: stored.checksum,
    name: nameOf(path),
    protected: unwrap(() => isProtectedPath(path, prefixes)),
  };
}

export async function putCommonFile(
  db: Db,
  store: ObjectStore,
  projectId: string,
  actor: Actor,
  rawPath: string,
  body: Buffer,
  declaredMime: string | null,
  ifMatch: string | null,
) {
  const opened = await openProject(db, projectId, actor, "write");
  const path = guardWrite(opened, actor, projectId, rawPath);
  const mime = unwrap(() => normalizeMime(path, declaredMime));
  if (body.length > LIMITS.maxFileBytes) {
    throw new AppError(400, "VALIDATION_FAILED", "单个文件超过 32MB");
  }
  const existing = await findActive(db, projectId, path);
  if (existing?.isDir) throw conflict("路径是文件夹");
  const tag = matchTag(ifMatch);
  if (tag && (!existing || existing.checksum !== tag)) {
    throw new AppError(412, "PRECONDITION_FAILED", "文件已被他人修改");
  }
  const delta = body.length - Number(existing?.size ?? 0);
  unwrap(() => assertQuota(opened.usedBytes, delta, opened.quotaBytes));
  const checksum = sha256Buffer(body);
  const key = unwrap(() => objectKey(opened.row.tenantId, projectId, checksum));
  await store.put(key, body);

  await txn(db, async (tx) => {
    const current = await findActive(tx, projectId, path);
    if (current?.isDir) throw conflict("路径是文件夹");
    if (tag && (!current || current.checksum !== tag)) {
      throw new AppError(412, "PRECONDITION_FAILED", "文件已被他人修改");
    }
    await ensureParents(tx, opened.row.tenantId, projectId, path, actor.userId);
    const next = (current?.currentVersion ?? 0) + 1;
    await adjustUsage(tx, projectId, body.length - Number(current?.size ?? 0));
    const fileId = current?.id ?? newId();
    if (current) {
      await tx
        .update(commonFiles)
        .set({
          size: body.length,
          mime,
          checksum,
          currentVersion: next,
          uploadedBy: actor.userId,
          isDir: false,
          updatedAt: new Date(),
        })
        .where(eq(commonFiles.id, current.id));
    } else {
      await tx.insert(commonFiles).values({
        id: fileId,
        tenantId: opened.row.tenantId,
        projectId,
        path,
        isDir: false,
        size: body.length,
        mime,
        checksum,
        currentVersion: next,
        uploadedBy: actor.userId,
      });
    }
    await tx.insert(commonFileVersions).values({
      fileId,
      version: next,
      objectKey: key,
      checksum,
      size: body.length,
      createdBy: actor.userId,
    });
    if (next > LIMITS.maxVersions) {
      await tx
        .delete(commonFileVersions)
        .where(
          and(
            eq(commonFileVersions.fileId, fileId),
            lte(commonFileVersions.version, next - LIMITS.maxVersions),
          ),
        );
    }
  });

  logger.info({ action: "common.write", projectId, path, userId: actor.userId }, "common file write");
  auditProtectedWrite(opened, actor, projectId, path);
  return entryByPath(db, projectId, path, opened.prefixes);
}

export async function createCommonDir(db: Db, projectId: string, actor: Actor, rawPath: string) {
  const opened = await openProject(db, projectId, actor, "write");
  const path = guardWrite(opened, actor, projectId, rawPath);
  const existing = await findActive(db, projectId, path);
  if (existing?.isDir) return toEntry(existing, await displayName(db, existing.uploadedBy), opened.prefixes);
  if (existing) throw conflict("路径与已有文件冲突");
  await txn(db, async (tx) => {
    await ensureParents(tx, opened.row.tenantId, projectId, path, actor.userId);
    const again = await findActive(tx, projectId, path);
    if (again?.isDir) return;
    if (again) throw conflict("路径与已有文件冲突");
    await tx.insert(commonFiles).values({
      id: newId(),
      tenantId: opened.row.tenantId,
      projectId,
      path,
      isDir: true,
      size: 0,
      currentVersion: 0,
      uploadedBy: actor.userId,
    });
  });
  return entryByPath(db, projectId, path, opened.prefixes);
}

async function displayName(db: Query, userId: string) {
  const [user] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.displayName ?? "user";
}

export async function moveCommonFile(db: Db, projectId: string, actor: Actor, rawPath: string, rawDest: string) {
  const opened = await openProject(db, projectId, actor, "write");
  const path = guardWrite(opened, actor, projectId, rawPath);
  const dest = guardWrite(opened, actor, projectId, rawDest);
  if (path === dest) return entryByPath(db, projectId, path, opened.prefixes);
  const source = await findActive(db, projectId, path);
  if (!source) throw notFound("File not found");
  if (source.isDir && (dest === path || dest.startsWith(`${path}/`))) {
    throw new AppError(400, "INVALID_PATH", "不能把文件夹移动到自身里面");
  }
  const rows = await loadLive(db, projectId);
  const affected = rows.filter(
    (row) => row.file.path === path || (source.isDir && row.file.path.startsWith(`${path}/`)),
  );
  const moves = affected.map((row) => {
    const next = row.file.path === path ? dest : `${dest}${row.file.path.slice(path.length)}`;
    guardWrite(opened, actor, projectId, next);
    return { id: row.file.id, next };
  });
  const taken = new Set(rows.map((row) => row.file.path));
  for (const move of moves) {
    if (taken.has(move.next) && !affected.some((row) => row.file.path === move.next)) {
      throw conflict("目标路径已存在");
    }
  }
  await txn(db, async (tx) => {
    await ensureParents(tx, opened.row.tenantId, projectId, dest, actor.userId);
    for (const move of moves.sort((a, b) => b.next.length - a.next.length)) {
      await tx
        .update(commonFiles)
        .set({ path: move.next, updatedAt: new Date(), uploadedBy: actor.userId })
        .where(eq(commonFiles.id, move.id));
    }
  });
  logger.info({ action: "common.write", projectId, path, dest, userId: actor.userId }, "common file move");
  auditProtectedWrite(opened, actor, projectId, dest);
  return entryByPath(db, projectId, dest, opened.prefixes);
}

export async function deleteCommonFile(
  db: Db,
  projectId: string,
  actor: Actor,
  rawPath: string,
  recursive: boolean,
) {
  const opened = await openProject(db, projectId, actor, "write");
  const path = guardWrite(opened, actor, projectId, rawPath);
  const source = await findActive(db, projectId, path);
  if (!source) throw notFound("File not found");
  const rows = await loadLive(db, projectId);
  const affected = rows.filter(
    (row) => row.file.path === path || (source.isDir && row.file.path.startsWith(`${path}/`)),
  );
  if (source.isDir && !recursive && affected.length > 1) {
    throw conflict("文件夹非空，需要 recursive=1");
  }
  const bytes = affected.reduce((sum, row) => sum + (row.file.isDir ? 0 : Number(row.file.size)), 0);
  const now = new Date();
  await txn(db, async (tx) => {
    for (const row of affected) {
      await tx.update(commonFiles).set({ deletedAt: now, updatedAt: now }).where(eq(commonFiles.id, row.file.id));
    }
    await adjustUsage(tx, projectId, -bytes);
  });
  logger.info({ action: "common.write", projectId, path, userId: actor.userId }, "common file delete");
  auditProtectedWrite(opened, actor, projectId, path);
}

export async function listCommonVersions(db: Db, projectId: string, actor: Actor, rawPath: string) {
  await openProject(db, projectId, actor, "read");
  const path = unwrap(() => canonicalizePath(rawPath));
  const row = await findActive(db, projectId, path);
  if (!row || row.isDir) throw notFound("File not found");
  const versions = await db
    .select()
    .from(commonFileVersions)
    .where(eq(commonFileVersions.fileId, row.id))
    .orderBy(desc(commonFileVersions.version));
  return {
    versions: versions.map((version) => ({
      version: version.version,
      size: Number(version.size),
      checksum: version.checksum,
      createdBy: version.createdBy,
      createdAt: toIso(version.createdAt)!,
    })),
  };
}

export async function restoreCommonVersion(
  db: Db,
  store: ObjectStore,
  projectId: string,
  actor: Actor,
  rawPath: string,
  version: number,
) {
  const opened = await openProject(db, projectId, actor, "write");
  const path = guardWrite(opened, actor, projectId, rawPath);
  const row = await findActive(db, projectId, path);
  if (!row || row.isDir) throw notFound("File not found");
  const [stored] = await db
    .select()
    .from(commonFileVersions)
    .where(and(eq(commonFileVersions.fileId, row.id), eq(commonFileVersions.version, version)))
    .limit(1);
  if (!stored) throw notFound("File version not found");
  const body = await store.get(stored.objectKey);
  return putCommonFile(db, store, projectId, actor, path, body, row.mime, null);
}

export async function searchCommonFiles(db: Db, projectId: string, actor: Actor, q: string) {
  const { prefixes } = await openProject(db, projectId, actor, "read");
  const needle = q.trim().toLowerCase();
  if (!needle) throw new AppError(400, "VALIDATION_FAILED", "q is required");
  const rows = await loadLive(db, projectId);
  const items = rows
    .filter((row) => row.file.path.toLowerCase().includes(needle))
    .slice(0, 50)
    .map((row) => toEntry(row.file, row.displayName, prefixes));
  return { items, nextCursor: null };
}

export async function getCommonSettings(db: Db, projectId: string, actor: Actor): Promise<CommonSettings> {
  const { prefixes, usedBytes, quotaBytes, row } = await openProject(db, projectId, actor, "protected");
  return {
    quotaBytes,
    usedBytes,
    protectedPrefixes: prefixes,
    syncPolicy: row.commonSyncPolicy as CommonSettings["syncPolicy"],
  };
}

export async function putCommonSettings(
  db: Db,
  projectId: string,
  actor: Actor,
  input: { quotaBytes?: number; protectedPrefixes?: string[]; syncPolicy?: CommonSettings["syncPolicy"] },
): Promise<CommonSettings> {
  const opened = await openProject(db, projectId, actor, "protected");
  const quota = input.quotaBytes ?? opened.quotaBytes;
  if (quota < opened.usedBytes) {
    throw new AppError(400, "VALIDATION_FAILED", "配额不能小于已用空间");
  }
  const prefixes = input.protectedPrefixes
    ? [...new Set(input.protectedPrefixes.map((prefix) => unwrap(() => canonicalizePath(prefix))))]
    : null;
  await txn(db, async (tx) => {
    await tx
      .update(projects)
      .set({
        commonQuotaBytes: quota,
        ...(input.syncPolicy ? { commonSyncPolicy: input.syncPolicy } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
    if (prefixes) {
      await tx
        .delete(commonProtectedPrefixes)
        .where(eq(commonProtectedPrefixes.projectId, projectId));
      if (prefixes.length > 0) {
        await tx.insert(commonProtectedPrefixes).values(prefixes.map((prefix) => ({ projectId, prefix })));
      }
    }
  });
  const saved = await getCommonSettings(db, projectId, actor);
  recordAudit({
    action: "common.protected_prefixes",
    actorId: actor.userId,
    tenantId: opened.row.tenantId,
    projectId,
    targetType: "project",
    targetId: projectId,
    meta: {
      protectedPrefixes: saved.protectedPrefixes,
      syncPolicy: saved.syncPolicy,
      quotaBytes: saved.quotaBytes,
    },
  });
  return saved;
}

export async function uploadCommonFiles(
  db: Db,
  store: ObjectStore,
  projectId: string,
  actor: Actor,
  prefixRaw: string,
  files: { name: string; bytes: Buffer; mime: string | null }[],
) {
  if (files.length === 0) throw new AppError(400, "VALIDATION_FAILED", "files is required");
  if (files.length > 20) throw new AppError(400, "VALIDATION_FAILED", "一次最多上传 20 个文件");
  const prefix = prefixRaw ? unwrap(() => canonicalizePath(prefixRaw)) : "";
  const entries: CommonEntry[] = [];
  for (const file of files) {
    const path = unwrap(() => joinPrefix(prefix, file.name));
    entries.push(await putCommonFile(db, store, projectId, actor, path, file.bytes, file.mime, null));
  }
  return { entries };
}

export async function uploadCommonZip(
  db: Db,
  store: ObjectStore,
  projectId: string,
  actor: Actor,
  prefixRaw: string,
  zip: Buffer,
) {
  await openProject(db, projectId, actor, "write");
  const prefix = prefixRaw ? unwrap(() => canonicalizePath(prefixRaw)) : "";
  let packed;
  try {
    packed = unzipStored(zip, {
      maxEntries: LIMITS.maxZipEntries,
      maxUncompressed: LIMITS.maxZipUncompressed,
    });
  } catch (err) {
    throw new AppError(400, "VALIDATION_FAILED", err instanceof Error ? err.message : "invalid zip");
  }
  let created = 0;
  const skipped: { path: string; reason: string }[] = [];
  for (const entry of packed) {
    const raw = prefix ? `${prefix}/${entry.path}` : entry.path;
    if (entry.symlink) {
      skipped.push({ path: entry.path, reason: "symlink" });
      continue;
    }
    try {
      const path = unwrap(() => canonicalizePath(raw));
      await putCommonFile(db, store, projectId, actor, path, entry.data, null, null);
      created += 1;
    } catch (err) {
      if (err instanceof AppError && err.code === "QUOTA_EXCEEDED") {
        skipped.push({ path: entry.path, reason: err.message });
        break;
      }
      if (err instanceof AppError) {
        skipped.push({ path: entry.path, reason: err.message });
        continue;
      }
      throw err;
    }
  }
  return { created, skipped };
}

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
      ? { diffSummary: { added: diff.added ?? [], removed: diff.removed ?? [], changed: diff.changed ?? [] } }
      : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.startedAt ? { startedAt: toIso(row.startedAt)! } : {}),
    ...(row.finishedAt ? { finishedAt: toIso(row.finishedAt)! } : {}),
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

async function currentObjects(db: Db, store: ObjectStore, projectId: string) {
  const rows = await loadLive(db, projectId);
  const files: { path: string; content: Buffer; checksum: string }[] = [];
  for (const row of rows) {
    if (row.file.isDir || !row.file.checksum) continue;
    const [version] = await db
      .select()
      .from(commonFileVersions)
      .where(
        and(
          eq(commonFileVersions.fileId, row.file.id),
          eq(commonFileVersions.version, row.file.currentVersion),
        ),
      )
      .limit(1);
    if (!version) throw new AppError(500, "INTERNAL", `缺少文件版本 ${row.file.path}`);
    const content = await store.get(version.objectKey);
    if (sha256Buffer(content) !== version.checksum) {
      throw new AppError(500, "INTERNAL", `对象摘要不一致 ${row.file.path}`);
    }
    files.push({ path: row.file.path, content, checksum: version.checksum });
  }
  return files;
}

export async function syncWorkspaceCommon(
  db: Db,
  store: ObjectStore,
  workspaceId: string,
  actor: Actor,
  env: CommonSyncEnv,
  trigger: Trigger,
) {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace || workspace.status === "deleted") throw notFound("Workspace not found");
  const opened = await openProject(db, workspace.projectId, actor, "read");
  if (
    !can(opened.resolved.projectRole, opened.resolved.tenantRole, "workspace.own", {
      isPlatformAdmin: actor.isPlatformAdmin,
    })
  ) {
    throw forbidden();
  }
  if (workspace.ownerUserId !== actor.userId && !actor.isPlatformAdmin) {
    throw notFound("Workspace not found");
  }
  if (opened.resolved.project.archivedAt) {
    throw conflict("Project is archived", undefined, "PROJECT_ARCHIVED");
  }
  await assertTenantActive(db, workspace.tenantId);

  const files = await currentObjects(db, store, workspace.projectId);
  const hash = snapshotHash(files.map((file) => ({ path: file.path, checksum: file.checksum })));
  const manifest = Object.fromEntries(files.map((file) => [file.path, file.checksum]));
  const id = newId();
  const now = new Date();

  if (workspace.commonSnapshotHash === hash) {
    const [job] = await db
      .insert(applyJobs)
      .values({
        id,
        tenantId: workspace.tenantId,
        workspaceId: workspace.id,
        instanceId: workspace.instanceId,
        kind: "common",
        targetHash: hash,
        trigger,
        status: "skipped",
        requestedBy: actor.userId,
        startedAt: now,
        finishedAt: now,
        diffSummary: { added: [], removed: [], changed: [], expected: manifest },
      })
      .returning();
    return mapJob(job!);
  }

  const instance = workspace.instanceId
    ? ((
        await db
          .select()
          .from(runtimeInstances)
          .where(eq(runtimeInstances.id, workspace.instanceId))
          .limit(1)
      )[0] ?? null)
    : null;
  const root = localRoot(workspace, instance, env.applyRoot);

  if (root) {
    const written = await materializeCommonTree(
      root,
      files.map((file) => ({ path: file.path, content: file.content })),
    );
    const [job] = await db
      .insert(applyJobs)
      .values({
        id,
        tenantId: workspace.tenantId,
        workspaceId: workspace.id,
        instanceId: workspace.instanceId,
        kind: "common",
        targetHash: hash,
        trigger,
        channel: "file",
        status: "succeeded",
        requestedBy: actor.userId,
        startedAt: now,
        finishedAt: now,
        diffSummary: {
          added: written.added,
          removed: written.removed,
          changed: written.changed,
          channels: { file: "ok", api: "skipped" },
          expected: written.manifest,
        },
      })
      .returning();
    await db
      .update(workspaces)
      .set({ commonSnapshotHash: hash, commonSyncedAt: now, updatedAt: now })
      .where(eq(workspaces.id, workspace.id));
    return mapJob(job!);
  }

  if (instance?.mode === "external" && instance.hasSyncAgent) {
    const payload = {
      files: files.map((file) => ({
        path: file.path,
        sha256: file.checksum,
        contentBase64: file.content.toString("base64"),
      })),
    };
    const dir = join(env.applyRoot, "payloads");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.json`), JSON.stringify(payload));
    const [job] = await db
      .insert(applyJobs)
      .values({
        id,
        tenantId: workspace.tenantId,
        workspaceId: workspace.id,
        instanceId: workspace.instanceId,
        kind: "common",
        targetHash: hash,
        trigger,
        channel: "file",
        status: "running",
        requestedBy: actor.userId,
        startedAt: now,
        diffSummary: {
          added: [],
          removed: [],
          changed: [],
          channels: { file: "pending", api: "skipped" },
          expected: manifest,
        },
      })
      .returning();
    await db.insert(jobsOutbox).values({
      id,
      tenantId: workspace.tenantId,
      jobType: "common",
      payload: { applyJobId: id, workspaceId: workspace.id, targetHash: hash },
      status: "published",
      publishedAt: now,
    });
    return mapJob(job!);
  }

  const [job] = await db
    .insert(applyJobs)
    .values({
      id,
      tenantId: workspace.tenantId,
      workspaceId: workspace.id,
      instanceId: workspace.instanceId,
      kind: "common",
      targetHash: hash,
      trigger,
      channel: "file",
      status: "partial",
      error: "agenthub-sync 未连接，文件通道已跳过",
      requestedBy: actor.userId,
      startedAt: now,
      finishedAt: now,
      diffSummary: { added: [], removed: [], changed: [], expected: manifest },
    })
    .returning();
  return mapJob(job!);
}
