import { and, eq } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import {
  credentialVersions,
  projectCredentials,
  userCredentials,
} from "@agenthub/db";
import { can, effectiveProjectRole } from "@agenthub/auth";
import type { ProjectCredential, UserCredential } from "@agenthub/domain";
import { conflict, forbidden, notFound } from "../errors.js";
import { buildCredentialOptions } from "../lib/credential-options.js";
import { allowedHostsOf, assertProviderHostAllowed } from "../lib/provider-hosts.js";
import { last4OfSecret } from "../lib/crypto.js";
import { openCredentialSecret, sealUserSecret, sealWithTenantDek, secretAad } from "../lib/envelope.js";
import { activeKek } from "../lib/kek.js";
import { logger } from "../lib/logger.js";
import { ensureTenantDek, loadTenantDek } from "./tenant-dek.js";
import { newId } from "../lib/id.js";
import { toIso } from "../lib/time.js";
import { resolveProjectAccess } from "./projects.js";

function mapUserCred(row: typeof userCredentials.$inferSelect): UserCredential {
  return {
    id: row.id,
    provider: row.provider as UserCredential["provider"],
    label: row.label,
    metadata: (row.metadata ?? {}) as UserCredential["metadata"],
    last4: row.last4,
    status: row.status as UserCredential["status"],
    version: row.currentVersion,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

function mapProjectCred(row: typeof projectCredentials.$inferSelect): ProjectCredential {
  return {
    id: row.id,
    provider: row.provider as ProjectCredential["provider"],
    label: row.label,
    metadata: (row.metadata ?? {}) as ProjectCredential["metadata"],
    last4: row.last4,
    status: row.status as ProjectCredential["status"],
    version: row.currentVersion,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
    allowedRoles: (row.allowedRoles ?? []) as ProjectCredential["allowedRoles"],
    isDefault: row.isDefault,
  };
}

export async function listCredentialOptions(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "session.create", { isPlatformAdmin })) {
    throw forbidden();
  }
  const role = effectiveProjectRole(access.projectRole, access.tenantRole);
  const canUseProject = can(
    access.projectRole,
    access.tenantRole,
    "credential.project.use",
    { isPlatformAdmin },
  );
  const userRows = await db
    .select()
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId));
  const projectRows = await db
    .select()
    .from(projectCredentials)
    .where(eq(projectCredentials.projectId, projectId));
  return buildCredentialOptions({
    policy: access.project.credentialPolicy as "user_or_project" | "project_only" | "user_only",
    role,
    canUseProject,
    userCredentials: userRows.map((row) => ({
      id: row.id,
      label: row.label,
      provider: row.provider as UserCredential["provider"],
      status: row.status,
    })),
    projectCredentials: projectRows.map((row) => ({
      id: row.id,
      label: row.label,
      provider: row.provider as UserCredential["provider"],
      status: row.status,
      isDefault: row.isDefault,
      allowedRoles: row.allowedRoles ?? [],
    })),
  });
}

/** New version is current. immediate revokes the previous snapshot; graceful leaves it usable. */
async function insertCredentialVersion(
  db: Db,
  input: {
    kind: "user" | "project";
    credentialId: string;
    previousVersion: number;
    secret: string;
    platformDek: string;
    createdBy: string;
    rotationMode?: "graceful" | "immediate";
    tenantId?: string;
    tenantDek?: Buffer;
  },
) {
  const version = input.previousVersion + 1;
  const kek = activeKek(input.platformDek);
  const sealed =
    input.kind === "project" && input.tenantDek && input.tenantId
      ? {
          blob: sealWithTenantDek(
            input.secret,
            secretAad({ tenantId: input.tenantId, kind: "project", id: input.credentialId, version }),
            input.tenantDek,
            kek.currentVersion,
          ),
          keyVersion: kek.currentVersion,
        }
      : await sealUserSecret(input.secret, input.credentialId, version, input.platformDek);
  await db.insert(credentialVersions).values({
    credentialKind: input.kind,
    credentialId: input.credentialId,
    version,
    secretCiphertext: sealed.blob,
    keyVersion: sealed.keyVersion,
    createdBy: input.createdBy,
  });
  if (input.rotationMode === "immediate") {
    await db
      .update(credentialVersions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(credentialVersions.credentialKind, input.kind),
          eq(credentialVersions.credentialId, input.credentialId),
          eq(credentialVersions.version, input.previousVersion),
        ),
      );
  }
  return version;
}

export async function listUserCredentials(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId));
  return { items: rows.map(mapUserCred), nextCursor: null as string | null };
}

export async function createUserCredential(
  db: Db,
  userId: string,
  platformDek: string,
  input: {
    provider: string;
    label: string;
    secret?: string;
    metadata?: Record<string, unknown>;
    status?: "active" | "disabled";
  },
) {
  if (!input.secret) throw conflict("secret is required when creating a credential");
  const id = newId();
  const sealed = await sealUserSecret(input.secret, id, 1, platformDek);
  const [row] = await db
    .insert(userCredentials)
    .values({
      id,
      userId,
      provider: input.provider,
      label: input.label,
      metadata: input.metadata ?? {},
      last4: last4OfSecret(input.secret),
      status: input.status ?? "active",
      currentVersion: 1,
    })
    .returning();
  await db.insert(credentialVersions).values({
    credentialKind: "user",
    credentialId: id,
    version: 1,
    secretCiphertext: sealed.blob,
    keyVersion: sealed.keyVersion,
    createdBy: userId,
  });
  return mapUserCred(row!);
}

export async function updateUserCredential(
  db: Db,
  userId: string,
  credentialId: string,
  platformDek: string,
  input: {
    provider?: string;
    label?: string;
    secret?: string;
    metadata?: Record<string, unknown>;
    status?: "active" | "disabled";
    rotationMode?: "graceful" | "immediate";
  },
) {
  const [row] = await db
    .select()
    .from(userCredentials)
    .where(and(eq(userCredentials.id, credentialId), eq(userCredentials.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Credential not found");

  let version = row.currentVersion;
  let last4 = row.last4;
  if (input.secret) {
    last4 = last4OfSecret(input.secret);
    version = await insertCredentialVersion(db, {
      kind: "user",
      credentialId,
      previousVersion: row.currentVersion,
      secret: input.secret,
      platformDek,
      createdBy: userId,
      rotationMode: input.rotationMode,
    });
  }

  const [updated] = await db
    .update(userCredentials)
    .set({
      provider: input.provider ?? row.provider,
      label: input.label ?? row.label,
      metadata: input.metadata ?? row.metadata,
      status: input.status ?? row.status,
      last4,
      currentVersion: version,
      updatedAt: new Date(),
    })
    .where(eq(userCredentials.id, credentialId))
    .returning();
  return mapUserCred(updated!);
}

export async function deleteUserCredential(db: Db, userId: string, credentialId: string) {
  const deleted = await db
    .delete(userCredentials)
    .where(and(eq(userCredentials.id, credentialId), eq(userCredentials.userId, userId)))
    .returning();
  if (deleted.length === 0) throw notFound("Credential not found");
}

export async function listProjectCredentials(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "project.read", { isPlatformAdmin })) {
    throw forbidden();
  }
  const rows = await db
    .select()
    .from(projectCredentials)
    .where(eq(projectCredentials.projectId, projectId));
  return { items: rows.map(mapProjectCred), nextCursor: null as string | null };
}

export async function createProjectCredential(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  input: {
    provider: string;
    label: string;
    secret?: string;
    metadata?: Record<string, unknown>;
    status?: "active" | "disabled";
    allowedRoles?: string[];
    isDefault?: boolean;
  },
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (
    !can(access.projectRole, access.tenantRole, "credential.project.manage", {
      isPlatformAdmin,
    })
  ) {
    throw forbidden();
  }
  if (!input.secret) throw conflict("secret is required when creating a credential");
  assertProviderHostAllowed(
    input.metadata?.baseUrl as string | undefined,
    allowedHostsOf(access.project.settings),
  );

  if (input.isDefault) {
    await db
      .update(projectCredentials)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(projectCredentials.projectId, projectId));
  }

  const id = newId();
  const ensured = await ensureTenantDek(db, access.project.tenantId, platformDek);
  const ciphertext = sealWithTenantDek(
    input.secret,
    secretAad({ tenantId: access.project.tenantId, kind: "project", id, version: 1 }),
    ensured.dek,
    ensured.version,
  );
  const [row] = await db
    .insert(projectCredentials)
    .values({
      id,
      tenantId: access.project.tenantId,
      projectId,
      provider: input.provider,
      label: input.label,
      metadata: input.metadata ?? {},
      last4: last4OfSecret(input.secret),
      allowedRoles: input.allowedRoles ?? ["owner", "developer"],
      isDefault: input.isDefault ?? false,
      status: input.status ?? "active",
      currentVersion: 1,
      createdBy: userId,
    })
    .returning();

  await db.insert(credentialVersions).values({
    credentialKind: "project",
    credentialId: id,
    version: 1,
    secretCiphertext: ciphertext,
    keyVersion: ensured.version,
    createdBy: userId,
  });

  return mapProjectCred(row!);
}

export async function updateProjectCredential(
  db: Db,
  projectId: string,
  credentialId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  input: {
    provider?: string;
    label?: string;
    secret?: string;
    metadata?: Record<string, unknown>;
    status?: "active" | "disabled";
    allowedRoles?: string[];
    isDefault?: boolean;
    rotationMode?: "graceful" | "immediate";
  },
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (
    !can(access.projectRole, access.tenantRole, "credential.project.manage", {
      isPlatformAdmin,
    })
  ) {
    throw forbidden();
  }
  const [row] = await db
    .select()
    .from(projectCredentials)
    .where(
      and(
        eq(projectCredentials.id, credentialId),
        eq(projectCredentials.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) throw notFound("Credential not found");
  if (input.metadata) {
    assertProviderHostAllowed(
      input.metadata.baseUrl as string | undefined,
      allowedHostsOf(access.project.settings),
    );
  }

  if (input.isDefault) {
    await db
      .update(projectCredentials)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(projectCredentials.projectId, projectId));
  }

  let version = row.currentVersion;
  let last4 = row.last4;
  if (input.secret) {
    last4 = last4OfSecret(input.secret);
    const ensured = await ensureTenantDek(db, row.tenantId, platformDek);
    version = await insertCredentialVersion(db, {
      kind: "project",
      credentialId,
      previousVersion: row.currentVersion,
      secret: input.secret,
      platformDek,
      createdBy: userId,
      rotationMode: input.rotationMode,
      tenantId: row.tenantId,
      tenantDek: ensured.dek,
    });
  }

  const [updated] = await db
    .update(projectCredentials)
    .set({
      provider: input.provider ?? row.provider,
      label: input.label ?? row.label,
      metadata: input.metadata ?? row.metadata,
      status: input.status ?? row.status,
      allowedRoles: input.allowedRoles ?? row.allowedRoles,
      isDefault: input.isDefault ?? row.isDefault,
      last4,
      currentVersion: version,
      updatedAt: new Date(),
    })
    .where(eq(projectCredentials.id, credentialId))
    .returning();
  return mapProjectCred(updated!);
}

export async function deleteProjectCredential(
  db: Db,
  projectId: string,
  credentialId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (
    !can(access.projectRole, access.tenantRole, "credential.project.manage", {
      isPlatformAdmin,
    })
  ) {
    throw forbidden();
  }
  const deleted = await db
    .delete(projectCredentials)
    .where(
      and(
        eq(projectCredentials.id, credentialId),
        eq(projectCredentials.projectId, projectId),
      ),
    )
    .returning();
  if (deleted.length === 0) throw notFound("Credential not found");
}

export type CredentialProbe = { ok: boolean; latencyMs?: number; error?: string };

/** Reachability check. The secret is sent only as a request header and is never logged. */
export async function probeProviderBaseUrl(
  baseUrl: string,
  secret: string,
  timeoutMs = 5_000,
): Promise<CredentialProbe> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, error: "Base URL 不是合法地址" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Base URL 必须是 http 或 https" };
  }
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const raw = Buffer.from(secret, "utf8");
  try {
    await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${raw.toString("utf8")}` },
      redirect: "manual",
      signal: ctrl.signal,
    });
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started, error: "无法连接该地址" };
  } finally {
    clearTimeout(timer);
    raw.fill(0);
  }
}

async function loadCurrentSecret(
  db: Db,
  kind: "user" | "project",
  credentialId: string,
  version: number,
  platformDek: string,
  tenantId: string | null,
) {
  const [row] = await db
    .select()
    .from(credentialVersions)
    .where(
      and(
        eq(credentialVersions.credentialKind, kind),
        eq(credentialVersions.credentialId, credentialId),
        eq(credentialVersions.version, version),
      ),
    )
    .limit(1);
  if (!row || row.revokedAt) return null;
  const tenantDek = tenantId ? await loadTenantDek(db, tenantId, activeKek(platformDek)) : null;
  return openCredentialSecret(Buffer.from(row.secretCiphertext), {
    platformDek,
    kind,
    id: credentialId,
    version,
    tenantId,
    tenantDek,
  });
}

function baseUrlOf(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || !("baseUrl" in metadata)) return undefined;
  const value = (metadata as { baseUrl?: unknown }).baseUrl;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function testUserCredential(
  db: Db,
  userId: string,
  credentialId: string,
  platformDek: string,
) {
  const [row] = await db
    .select()
    .from(userCredentials)
    .where(and(eq(userCredentials.id, credentialId), eq(userCredentials.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Credential not found");
  const baseUrl = baseUrlOf(row.metadata);
  if (!baseUrl) return { ok: false, error: "请先填写 Base URL" } satisfies CredentialProbe;
  let secret: string | null = null;
  try {
    secret = await loadCurrentSecret(db, "user", row.id, row.currentVersion, platformDek, null);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.name : "open" }, "credential test decrypt failed");
    return { ok: false, error: "密钥无法读取，请轮换后再测" } satisfies CredentialProbe;
  }
  if (!secret) return { ok: false, error: "密钥无法读取，请轮换后再测" };
  try {
    return await probeProviderBaseUrl(baseUrl, secret);
  } finally {
    secret = null;
  }
}

export async function testProjectCredential(
  db: Db,
  projectId: string,
  credentialId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (
    !can(access.projectRole, access.tenantRole, "credential.project.manage", {
      isPlatformAdmin,
    })
  ) {
    throw forbidden();
  }
  const [row] = await db
    .select()
    .from(projectCredentials)
    .where(
      and(eq(projectCredentials.id, credentialId), eq(projectCredentials.projectId, projectId)),
    )
    .limit(1);
  if (!row) throw notFound("Credential not found");
  const baseUrl = baseUrlOf(row.metadata);
  if (!baseUrl) return { ok: false, error: "请先填写 Base URL" } satisfies CredentialProbe;
  let secret: string | null = null;
  try {
    secret = await loadCurrentSecret(
      db,
      "project",
      row.id,
      row.currentVersion,
      platformDek,
      row.tenantId,
    );
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.name : "open" }, "credential test decrypt failed");
    return { ok: false, error: "密钥无法读取，请轮换后再测" } satisfies CredentialProbe;
  }
  if (!secret) return { ok: false, error: "密钥无法读取，请轮换后再测" };
  try {
    return await probeProviderBaseUrl(baseUrl, secret);
  } finally {
    secret = null;
  }
}
