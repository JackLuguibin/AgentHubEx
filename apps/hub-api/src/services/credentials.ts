import { and, eq } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import {
  credentialVersions,
  projectCredentials,
  userCredentials,
} from "@agenthub/db";
import { can } from "@agenthub/auth";
import type { ProjectCredential, UserCredential } from "@agenthub/domain";
import { conflict, forbidden, notFound } from "../errors.js";
import { encryptSecret, last4OfSecret } from "../lib/crypto.js";
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
  const ciphertext = encryptSecret(input.secret, platformDek);
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
    secretCiphertext: ciphertext,
    keyVersion: 1,
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
    version += 1;
    last4 = last4OfSecret(input.secret);
    await db.insert(credentialVersions).values({
      credentialKind: "user",
      credentialId,
      version,
      secretCiphertext: encryptSecret(input.secret, platformDek),
      keyVersion: 1,
      createdBy: userId,
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

  if (input.isDefault) {
    await db
      .update(projectCredentials)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(projectCredentials.projectId, projectId));
  }

  const id = newId();
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
    secretCiphertext: encryptSecret(input.secret, platformDek),
    keyVersion: 1,
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

  if (input.isDefault) {
    await db
      .update(projectCredentials)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(projectCredentials.projectId, projectId));
  }

  let version = row.currentVersion;
  let last4 = row.last4;
  if (input.secret) {
    version += 1;
    last4 = last4OfSecret(input.secret);
    await db.insert(credentialVersions).values({
      credentialKind: "project",
      credentialId,
      version,
      secretCiphertext: encryptSecret(input.secret, platformDek),
      keyVersion: 1,
      createdBy: userId,
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
