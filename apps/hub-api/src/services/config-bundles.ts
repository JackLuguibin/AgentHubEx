import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import {
  configAssignments,
  configBlobs,
  configBundles,
  configRevisions,
  projectCredentials,
  projects,
  tenants,
} from "@agenthub/db";
import { can, effectiveProjectRole, type Permission } from "@agenthub/auth";
import {
  ConfigLockSchema,
  ManifestSchema,
  type ApplyJob,
  type Bundle,
  type ConfigLock,
  type EffectiveConfig,
  type Manifest,
  type Revision,
  type SecretRef,
} from "@agenthub/domain";
import {
  contentHash,
  mergeConfig,
  normalizeSkillFilePath,
  sha256Buffer,
  validateManifest,
} from "@agenthub/config-bundle";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError, conflict, forbidden, notFound } from "../errors.js";
import { newId } from "../lib/id.js";
import { etagFromUpdatedAt, toIso } from "../lib/time.js";
import { requireTenantAdmin } from "./tenants.js";
import { resolveProjectAccess } from "./projects.js";

const DEFAULT_COMMANDS = ["npx", "node", "uvx", "docker", "python", "python3"];

type Actor = { userId: string; isPlatformAdmin: boolean };

function etagMatches(header: string | undefined, current: string): boolean {
  if (!header) return false;
  const norm = (value: string) => value.trim().replace(/^W\//, "").replaceAll('"', "");
  return norm(header) === norm(current);
}

async function requireProject(
  db: Db,
  projectId: string,
  actor: Actor,
  perm: Permission,
) {
  const resolved = await resolveProjectAccess(
    db,
    projectId,
    actor.userId,
    actor.isPlatformAdmin,
  );
  if (
    !can(resolved.projectRole, resolved.tenantRole, perm, {
      isPlatformAdmin: actor.isPlatformAdmin,
    })
  ) {
    throw forbidden();
  }
  if (resolved.project.archivedAt && perm !== "config.read_effective") {
    throw conflict("Project is archived", undefined, "PROJECT_ARCHIVED");
  }
  return resolved;
}

async function latestPublished(db: Db, bundleIds: string[]) {
  const map = new Map<string, number>();
  if (bundleIds.length === 0) return map;
  const rows = await db
    .select()
    .from(configRevisions)
    .where(and(inArray(configRevisions.bundleId, bundleIds), eq(configRevisions.state, "published")));
  for (const row of rows) {
    const prev = map.get(row.bundleId) ?? 0;
    if (row.version > prev) map.set(row.bundleId, row.version);
  }
  return map;
}

function mapBundle(
  row: typeof configBundles.$inferSelect,
  latestVersion: number | null,
): Bundle {
  return {
    id: row.id,
    scope: row.scope as Bundle["scope"],
    scopeId: row.scopeId,
    name: row.name,
    draft: ManifestSchema.parse(row.draft ?? {}),
    latestVersion,
    updatedAt: toIso(row.updatedAt)!,
    etag: etagFromUpdatedAt(row.updatedAt),
  };
}

function mapRevision(row: typeof configRevisions.$inferSelect): Revision {
  return {
    id: row.id,
    bundleId: row.bundleId,
    version: row.version,
    state: row.state as Revision["state"],
    contentHash: row.contentHash,
    ...(row.changelog ? { changelog: row.changelog } : {}),
    publishedBy: row.publishedBy,
    publishedAt: toIso(row.publishedAt)!,
  };
}

async function bundleOrThrow(db: Db, bundleId: string) {
  const [row] = await db.select().from(configBundles).where(eq(configBundles.id, bundleId)).limit(1);
  if (!row) throw notFound("Bundle not found");
  return row;
}

async function authorizeBundle(db: Db, bundleId: string, actor: Actor, perm: Permission) {
  const bundle = await bundleOrThrow(db, bundleId);
  if (bundle.scope === "project" && bundle.scopeId) {
    await requireProject(db, bundle.scopeId, actor, perm);
    return bundle;
  }
  if (bundle.scope === "tenant" && bundle.tenantId) {
    await requireTenantAdmin(db, bundle.tenantId, actor.userId, actor.isPlatformAdmin);
    return bundle;
  }
  if (bundle.scope === "user" && bundle.name.startsWith("overlay:")) {
    const projectId = bundle.name.slice("overlay:".length);
    await requireProject(db, projectId, actor, "workspace.own");
    if (bundle.scopeId !== actor.userId && !actor.isPlatformAdmin) throw forbidden();
    return bundle;
  }
  if (bundle.scope === "platform" && actor.isPlatformAdmin) return bundle;
  throw forbidden();
}

async function commandWhitelist(db: Db, tenantId: string | null) {
  if (!tenantId) return DEFAULT_COMMANDS;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const settings = (tenant?.settings ?? {}) as { mcpCommandWhitelist?: string[] };
  return settings.mcpCommandWhitelist?.length ? settings.mcpCommandWhitelist : DEFAULT_COMMANDS;
}

async function secretChecker(db: Db, projectId: string | null) {
  const ids = new Set<string>();
  if (projectId) {
    const rows = await db
      .select({ id: projectCredentials.id })
      .from(projectCredentials)
      .where(and(eq(projectCredentials.projectId, projectId), eq(projectCredentials.status, "active")));
    for (const row of rows) ids.add(row.id);
  }
  return (ref: SecretRef) => ref.$secret.kind === "projectCredential" && ids.has(ref.$secret.id);
}

function projectIdForBundle(bundle: typeof configBundles.$inferSelect): string | null {
  if (bundle.scope === "project") return bundle.scopeId;
  if (bundle.scope === "user" && bundle.name.startsWith("overlay:")) {
    return bundle.name.slice("overlay:".length);
  }
  return null;
}

export async function listProjectBundles(db: Db, projectId: string, actor: Actor) {
  await requireProject(db, projectId, actor, "config.read_effective");
  const rows = await db
    .select()
    .from(configBundles)
    .where(and(eq(configBundles.scope, "project"), eq(configBundles.scopeId, projectId)))
    .orderBy(asc(configBundles.createdAt));
  const versions = await latestPublished(db, rows.map((row) => row.id));
  return { items: rows.map((row) => mapBundle(row, versions.get(row.id) ?? null)), nextCursor: null };
}

export async function createProjectBundle(db: Db, projectId: string, actor: Actor, name: string) {
  const { project } = await requireProject(db, projectId, actor, "config.manage");
  const id = newId();
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(configBundles)
      .values({
        id,
        tenantId: project.tenantId,
        scope: "project",
        scopeId: projectId,
        name,
        draft: ManifestSchema.parse({}),
        draftUpdatedBy: actor.userId,
      })
      .returning();
    await tx.insert(configAssignments).values({
      projectId,
      bundleId: id,
      pin: "latest",
      ordering: 100,
    });
    return inserted;
  });
  return mapBundle(row!, null);
}

export async function listTenantBundles(db: Db, tenantId: string, actor: Actor) {
  await requireTenantAdmin(db, tenantId, actor.userId, actor.isPlatformAdmin);
  const rows = await db
    .select()
    .from(configBundles)
    .where(and(eq(configBundles.scope, "tenant"), eq(configBundles.scopeId, tenantId)))
    .orderBy(asc(configBundles.createdAt));
  const versions = await latestPublished(db, rows.map((row) => row.id));
  return { items: rows.map((row) => mapBundle(row, versions.get(row.id) ?? null)), nextCursor: null };
}

export async function createTenantBundle(db: Db, tenantId: string, actor: Actor, name: string) {
  await requireTenantAdmin(db, tenantId, actor.userId, actor.isPlatformAdmin);
  const id = newId();
  const [row] = await db
    .insert(configBundles)
    .values({
      id,
      tenantId,
      scope: "tenant",
      scopeId: tenantId,
      name,
      draft: ManifestSchema.parse({}),
      draftUpdatedBy: actor.userId,
    })
    .returning();
  return mapBundle(row!, null);
}

export async function getBundle(db: Db, bundleId: string, actor: Actor) {
  const bundle = await authorizeBundle(db, bundleId, actor, "config.read_effective");
  const versions = await latestPublished(db, [bundle.id]);
  return mapBundle(bundle, versions.get(bundle.id) ?? null);
}

export async function updateDraft(
  db: Db,
  bundleId: string,
  actor: Actor,
  ifMatch: string | undefined,
  draft: unknown,
) {
  const bundle = await authorizeBundle(db, bundleId, actor, "config.manage");
  const current = etagFromUpdatedAt(bundle.updatedAt);
  if (!etagMatches(ifMatch, current)) throw conflict("Draft was updated by someone else");
  const manifest = ManifestSchema.parse(draft);
  const [row] = await db
    .update(configBundles)
    .set({
      draft: manifest,
      draftUpdatedBy: actor.userId,
      updatedAt: new Date(),
    })
    .where(eq(configBundles.id, bundleId))
    .returning();
  const versions = await latestPublished(db, [bundleId]);
  return mapBundle(row!, versions.get(bundleId) ?? null);
}

export async function validateBundle(db: Db, bundleId: string, actor: Actor) {
  const bundle = await authorizeBundle(db, bundleId, actor, "config.manage");
  const result = validateManifest(bundle.draft, {
    commandWhitelist: await commandWhitelist(db, bundle.tenantId),
    secretResolvable: await secretChecker(db, projectIdForBundle(bundle)),
  });
  return { ok: result.ok, errors: result.errors };
}

async function assertDraftValid(db: Db, bundle: typeof configBundles.$inferSelect) {
  const result = validateManifest(bundle.draft, {
    commandWhitelist: await commandWhitelist(db, bundle.tenantId),
    secretResolvable: await secretChecker(db, projectIdForBundle(bundle)),
  });
  if (!result.ok || !result.manifest) {
    throw new AppError(400, "VALIDATION_FAILED", "Bundle validation failed", {
      fieldErrors: result.errors,
    });
  }
  return result.manifest;
}

export async function publishBundle(
  db: Db,
  bundleId: string,
  actor: Actor,
  changelog?: string,
) {
  const bundle = await authorizeBundle(db, bundleId, actor, "config.manage");
  const manifest = await assertDraftValid(db, bundle);
  const hash = contentHash(manifest);
  const [latest] = await db
    .select()
    .from(configRevisions)
    .where(eq(configRevisions.bundleId, bundleId))
    .orderBy(desc(configRevisions.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  const id = newId();
  const [row] = await db.transaction(async (tx) => {
    await tx
      .update(configRevisions)
      .set({ state: "archived" })
      .where(and(eq(configRevisions.bundleId, bundleId), eq(configRevisions.state, "published")));
    return tx
      .insert(configRevisions)
      .values({
        id,
        bundleId,
        version,
        state: "published",
        manifest,
        contentHash: hash,
        changelog,
        publishedBy: actor.userId,
      })
      .returning();
  });
  return mapRevision(row!);
}

export async function listRevisions(db: Db, bundleId: string, actor: Actor) {
  await authorizeBundle(db, bundleId, actor, "config.read_effective");
  const rows = await db
    .select()
    .from(configRevisions)
    .where(eq(configRevisions.bundleId, bundleId))
    .orderBy(desc(configRevisions.version));
  return { items: rows.map(mapRevision), nextCursor: null };
}

export async function diffRevision(
  db: Db,
  bundleId: string,
  revisionId: string,
  actor: Actor,
  againstId?: string,
) {
  await authorizeBundle(db, bundleId, actor, "config.read_effective");
  const [current] = await db
    .select()
    .from(configRevisions)
    .where(and(eq(configRevisions.id, revisionId), eq(configRevisions.bundleId, bundleId)))
    .limit(1);
  if (!current) throw notFound("Revision not found");
  const [against] = againstId
    ? await db
        .select()
        .from(configRevisions)
        .where(and(eq(configRevisions.id, againstId), eq(configRevisions.bundleId, bundleId)))
        .limit(1)
    : await db
        .select()
        .from(configRevisions)
        .where(and(eq(configRevisions.bundleId, bundleId), eq(configRevisions.version, current.version - 1)))
        .limit(1);
  const left = ManifestSchema.parse(against?.manifest ?? {});
  const right = ManifestSchema.parse(current.manifest);
  return diffManifests(left, right);
}

function assetKeys(manifest: Manifest) {
  const map = new Map<string, string>();
  for (const agent of manifest.agents) map.set(`agent:${agent.name}`, contentHash(agent));
  for (const item of manifest.mcp) map.set(`mcp:${item.name}`, contentHash(item));
  for (const skill of manifest.skills) map.set(`skill:${skill.name}`, contentHash(skill));
  map.set("instructions", contentHash(manifest.instructions));
  map.set("model", manifest.model ?? "");
  return map;
}

function diffManifests(left: Manifest, right: Manifest) {
  const a = assetKeys(left);
  const b = assetKeys(right);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [key, hash] of b) {
    if (!a.has(key)) added.push(key);
    else if (a.get(key) !== hash) changed.push(key);
  }
  for (const key of a.keys()) {
    if (!b.has(key)) removed.push(key);
  }
  return { added, removed, changed };
}

export async function rollbackBundle(db: Db, bundleId: string, actor: Actor, revisionId: string) {
  await authorizeBundle(db, bundleId, actor, "config.manage");
  const [target] = await db
    .select()
    .from(configRevisions)
    .where(and(eq(configRevisions.id, revisionId), eq(configRevisions.bundleId, bundleId)))
    .limit(1);
  if (!target) throw notFound("Revision not found");
  const [row] = await db.transaction(async (tx) => {
    await tx
      .update(configRevisions)
      .set({ state: "archived" })
      .where(and(eq(configRevisions.bundleId, bundleId), eq(configRevisions.state, "published")));
    return tx
      .update(configRevisions)
      .set({ state: "published" })
      .where(eq(configRevisions.id, revisionId))
      .returning();
  });
  return mapRevision(row!);
}

export async function putAssignments(
  db: Db,
  projectId: string,
  actor: Actor,
  items: { bundleId: string; pin: string; ordering: number }[],
) {
  const { project } = await requireProject(db, projectId, actor, "config.manage");
  for (const item of items) {
    if (item.pin !== "latest" && !/^[0-9a-f-]{36}$/i.test(item.pin)) {
      throw new AppError(400, "VALIDATION_FAILED", "pin must be latest or a revision id");
    }
    const bundle = await bundleOrThrow(db, item.bundleId);
    const sameTenant = bundle.tenantId === project.tenantId;
    const platform = bundle.scope === "platform";
    const thisProject = bundle.scope === "project" && bundle.scopeId === projectId;
    if (!sameTenant && !platform && !thisProject) throw forbidden("Bundle is outside this project");
    if (bundle.scope === "user") throw new AppError(400, "VALIDATION_FAILED", "User overlays are not assigned");
    if (item.pin !== "latest") {
      const [rev] = await db
        .select()
        .from(configRevisions)
        .where(and(eq(configRevisions.id, item.pin), eq(configRevisions.bundleId, bundle.id)))
        .limit(1);
      if (!rev) throw notFound("Pinned revision not found");
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(configAssignments).where(eq(configAssignments.projectId, projectId));
    if (items.length > 0) {
      await tx.insert(configAssignments).values(
        items.map((item) => ({
          projectId,
          bundleId: item.bundleId,
          pin: item.pin,
          ordering: item.ordering,
        })),
      );
    }
  });
  return { items };
}

export async function getLock(db: Db, projectId: string, actor: Actor): Promise<ConfigLock> {
  const { project } = await requireProject(db, projectId, actor, "config.read_effective");
  return ConfigLockSchema.parse(project.configLock ?? {});
}

export async function putLock(db: Db, projectId: string, actor: Actor, body: unknown) {
  await requireProject(db, projectId, actor, "config.manage");
  const lock = ConfigLockSchema.parse(body);
  await db
    .update(projects)
    .set({ configLock: lock, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  return lock;
}

async function pinnedManifest(db: Db, bundleId: string, pin: string): Promise<Manifest | null> {
  if (pin === "latest") {
    const [row] = await db
      .select()
      .from(configRevisions)
      .where(and(eq(configRevisions.bundleId, bundleId), eq(configRevisions.state, "published")))
      .orderBy(desc(configRevisions.version))
      .limit(1);
    return row ? ManifestSchema.parse(row.manifest) : null;
  }
  const [row] = await db
    .select()
    .from(configRevisions)
    .where(and(eq(configRevisions.id, pin), eq(configRevisions.bundleId, bundleId)))
    .limit(1);
  return row ? ManifestSchema.parse(row.manifest) : null;
}

export async function resolveEffectiveConfig(
  db: Db,
  projectId: string,
  actor: Actor,
  userId?: string,
): Promise<EffectiveConfig & { tenantId: string; role: "owner" | "developer" | "viewer" | null }> {
  const resolved = await requireProject(db, projectId, actor, "config.read_effective");
  const subject = userId ?? actor.userId;
  const subjectAccess =
    subject === actor.userId
      ? resolved
      : await resolveProjectAccess(db, projectId, subject, false).catch(() => resolved);
  const role = effectiveProjectRole(subjectAccess.projectRole, subjectAccess.tenantRole);
  const lock = ConfigLockSchema.parse(resolved.project.configLock ?? {});
  const assignments = await db
    .select()
    .from(configAssignments)
    .where(eq(configAssignments.projectId, projectId))
    .orderBy(asc(configAssignments.ordering));
  const bundleIds = assignments.map((item) => item.bundleId);
  const bundleRows = bundleIds.length
    ? await db.select().from(configBundles).where(inArray(configBundles.id, bundleIds))
    : [];
  const byId = new Map(bundleRows.map((row) => [row.id, row]));
  const layers: { scope: "platform" | "tenant" | "project" | "user"; manifest: Manifest }[] = [];
  for (const scope of ["platform", "tenant", "project"] as const) {
    for (const assignment of assignments) {
      const bundle = byId.get(assignment.bundleId);
      if (!bundle || bundle.scope !== scope) continue;
      const manifest = await pinnedManifest(db, bundle.id, assignment.pin);
      if (manifest) layers.push({ scope, manifest });
    }
  }
  const [overlay] = await db
    .select()
    .from(configBundles)
    .where(
      and(
        eq(configBundles.scope, "user"),
        eq(configBundles.scopeId, subject),
        eq(configBundles.name, `overlay:${projectId}`),
      ),
    )
    .limit(1);
  if (overlay) {
    const manifest = await pinnedManifest(db, overlay.id, "latest");
    if (manifest) layers.push({ scope: "user", manifest });
  }
  const merged = mergeConfig({
    layers,
    lock,
    ...(role ? { role } : {}),
  });
  return { ...merged, tenantId: resolved.project.tenantId, role };
}

export async function saveUserOverlay(db: Db, projectId: string, actor: Actor, draft: unknown) {
  const { project } = await requireProject(db, projectId, actor, "workspace.own");
  const manifest = ManifestSchema.parse(draft);
  const checked = validateManifest(manifest, {
    commandWhitelist: await commandWhitelist(db, project.tenantId),
    secretResolvable: await secretChecker(db, projectId),
  });
  if (!checked.ok || !checked.manifest) {
    throw new AppError(400, "VALIDATION_FAILED", "Overlay validation failed", {
      fieldErrors: checked.errors,
    });
  }
  const name = `overlay:${projectId}`;
  const [existing] = await db
    .select()
    .from(configBundles)
    .where(
      and(
        eq(configBundles.scope, "user"),
        eq(configBundles.scopeId, actor.userId),
        eq(configBundles.name, name),
      ),
    )
    .limit(1);
  const bundleId = existing?.id ?? newId();
  if (!existing) {
    await db.insert(configBundles).values({
      id: bundleId,
      tenantId: project.tenantId,
      scope: "user",
      scopeId: actor.userId,
      name,
      draft: checked.manifest,
      draftUpdatedBy: actor.userId,
    });
  } else {
    await db
      .update(configBundles)
      .set({ draft: checked.manifest, draftUpdatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(configBundles.id, bundleId));
  }
  return publishBundle(db, bundleId, actor);
}

export async function putBlob(
  db: Db,
  bundleId: string,
  actor: Actor,
  bytes: Buffer,
  blobRoot: string,
) {
  const bundle = await authorizeBundle(db, bundleId, actor, "config.manage");
  if (bytes.length > 2_000_000) {
    throw new AppError(400, "VALIDATION_FAILED", "Blob exceeds 2MB");
  }
  const sha256 = sha256Buffer(bytes);
  await mkdir(blobRoot, { recursive: true });
  await writeFile(join(blobRoot, sha256), bytes);
  await db
    .insert(configBlobs)
    .values({
      tenantId: bundle.tenantId,
      sha256,
      size: bytes.length,
      objectKey: `bundles/${bundle.tenantId ?? "platform"}/blobs/${sha256}`,
    })
    .onConflictDoNothing();
  return { sha256, size: bytes.length };
}

export async function readBlob(blobRoot: string, sha256: string): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw notFound("技能文件不在存储里，请在 Skill 页重新导入");
  try {
    return await readFile(join(blobRoot, sha256));
  } catch {
    throw notFound("技能文件不在存储里，请在 Skill 页重新导入");
  }
}

export async function importSkill(
  db: Db,
  bundleId: string,
  actor: Actor,
  blobRoot: string,
  input: { name: string; files: { path: string; bytes: Buffer }[] },
) {
  const bundle = await authorizeBundle(db, bundleId, actor, "config.manage");
  const files = [];
  for (const file of input.files) {
    const path = normalizeSkillFilePath(file.path);
    const saved = await putBlob(db, bundleId, actor, file.bytes, blobRoot);
    files.push({ path, sha256: saved.sha256, size: saved.size });
  }
  const draft = ManifestSchema.parse(bundle.draft ?? {});
  const skill = { name: input.name, files };
  const skills = [...draft.skills.filter((item) => item.name !== input.name), skill];
  const next = { ...draft, skills };
  const [row] = await db
    .update(configBundles)
    .set({ draft: next, draftUpdatedBy: actor.userId, updatedAt: new Date() })
    .where(eq(configBundles.id, bundleId))
    .returning();
  const versions = await latestPublished(db, [bundleId]);
  return { skill, bundle: mapBundle(row!, versions.get(bundleId) ?? null) };
}

export function emptyDiff(): NonNullable<ApplyJob["diffSummary"]> {
  return { added: [], removed: [], changed: [] };
}
