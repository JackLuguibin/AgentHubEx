import { and, count, eq } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { projectMemberships, projects, tenantMemberships, tenants, users } from "@agenthub/db";
import type { TenantRole } from "@agenthub/auth";
import type { Tenant } from "@agenthub/domain";
import { conflict, forbidden, notFound } from "../errors.js";
import { placeholderTenantDek } from "../lib/crypto.js";
import { newId } from "../lib/id.js";
import { toIso } from "../lib/time.js";
import { findOrCreateUserByEmail, getTenantMembership } from "./users.js";

const DEFAULT_QUOTA = {
  maxConcurrentSessionsPerUser: 5,
  maxActiveWorkspaces: 50,
};

const DEFAULT_SETTINGS = {
  allowedLoginMethods: ["password"],
};

function mapTenant(row: typeof tenants.$inferSelect): Tenant {
  const quota = (row.quota ?? {}) as Record<string, unknown>;
  const settings = (row.settings ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status as Tenant["status"],
    quota: {
      maxConcurrentSessionsPerUser:
        typeof quota.maxConcurrentSessionsPerUser === "number"
          ? quota.maxConcurrentSessionsPerUser
          : DEFAULT_QUOTA.maxConcurrentSessionsPerUser,
      maxActiveWorkspaces:
        typeof quota.maxActiveWorkspaces === "number"
          ? quota.maxActiveWorkspaces
          : DEFAULT_QUOTA.maxActiveWorkspaces,
      tokensPerDay: typeof quota.tokensPerDay === "number" ? quota.tokensPerDay : undefined,
    },
    settings: {
      allowedLoginMethods: Array.isArray(settings.allowedLoginMethods)
        ? (settings.allowedLoginMethods as string[])
        : DEFAULT_SETTINGS.allowedLoginMethods,
      defaultModel:
        typeof settings.defaultModel === "string" ? settings.defaultModel : undefined,
    },
    createdAt: toIso(row.createdAt)!,
  };
}

export async function createTenant(
  db: Db,
  platformDek: string,
  input: { slug: string; name: string; ownerEmail: string },
) {
  const [existing] = await db.select().from(tenants).where(eq(tenants.slug, input.slug)).limit(1);
  if (existing) throw conflict("Tenant slug already exists");

  const owner = await findOrCreateUserByEmail(db, input.ownerEmail, input.name);
  const id = newId();
  const [row] = await db
    .insert(tenants)
    .values({
      id,
      slug: input.slug,
      name: input.name,
      status: "active",
      quota: DEFAULT_QUOTA,
      settings: DEFAULT_SETTINGS,
      dekCiphertext: placeholderTenantDek(platformDek),
      dekKeyVersion: 1,
    })
    .returning();
  if (!row) throw new Error("failed to create tenant");

  await db.insert(tenantMemberships).values({
    tenantId: id,
    userId: owner.id,
    role: "owner",
  });

  return mapTenant(row);
}

export async function getTenant(db: Db, tenantId: string) {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!row) throw notFound("Tenant not found");
  return mapTenant(row);
}

/** Platform admin: list all tenants (paginated cursor reserved). */
export async function listAllTenants(db: Db) {
  const rows = await db.select().from(tenants);
  return {
    items: rows.map(mapTenant),
    nextCursor: null as string | null,
  };
}

export async function getTenantRow(db: Db, tenantId: string) {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!row) throw notFound("Tenant not found");
  return row;
}

export async function assertTenantActive(db: Db, tenantId: string) {
  const row = await getTenantRow(db, tenantId);
  if (row.status === "suspended") {
    throw conflict("Tenant is suspended", undefined, "TENANT_SUSPENDED");
  }
  return row;
}

export async function patchTenant(
  db: Db,
  tenantId: string,
  patch: {
    name?: string;
    quota?: Partial<Tenant["quota"]>;
    settings?: Partial<Tenant["settings"]>;
  },
) {
  const row = await getTenantRow(db, tenantId);
  const nextQuota = { ...(row.quota as object), ...(patch.quota ?? {}) };
  const nextSettings = { ...(row.settings as object), ...(patch.settings ?? {}) };
  const [updated] = await db
    .update(tenants)
    .set({
      name: patch.name ?? row.name,
      quota: nextQuota,
      settings: nextSettings,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId))
    .returning();
  return mapTenant(updated!);
}

export async function setTenantStatus(db: Db, tenantId: string, status: "active" | "suspended") {
  const [updated] = await db
    .update(tenants)
    .set({ status, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
    .returning();
  if (!updated) throw notFound("Tenant not found");
  return mapTenant(updated);
}

export async function requireTenantAdmin(
  db: Db,
  tenantId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  if (isPlatformAdmin) return { role: "owner" as TenantRole };
  const m = await getTenantMembership(db, tenantId, userId);
  if (!m) throw notFound("Tenant not found");
  if (m.role !== "owner" && m.role !== "admin") throw forbidden("Tenant admin required");
  return { role: m.role as TenantRole };
}

export async function requireTenantMember(
  db: Db,
  tenantId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  if (isPlatformAdmin) return { role: "owner" as TenantRole };
  const m = await getTenantMembership(db, tenantId, userId);
  if (!m) throw notFound("Tenant not found");
  return { role: m.role as TenantRole };
}

export async function listTenantMembers(db: Db, tenantId: string) {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: tenantMemberships.role,
      joinedAt: tenantMemberships.createdAt,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(eq(tenantMemberships.tenantId, tenantId));

  return {
    items: rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      displayName: r.displayName,
      role: r.role as TenantRole,
      joinedAt: toIso(r.joinedAt)!,
    })),
    nextCursor: null as string | null,
  };
}

export async function addTenantMember(
  db: Db,
  tenantId: string,
  input: { email: string; role: TenantRole },
) {
  await assertTenantActive(db, tenantId);
  const user = await findOrCreateUserByEmail(db, input.email);
  const existing = await getTenantMembership(db, tenantId, user.id);
  if (existing) throw conflict("User is already a tenant member");

  await db.insert(tenantMemberships).values({
    tenantId,
    userId: user.id,
    role: input.role,
  });

  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    role: input.role,
    joinedAt: new Date().toISOString(),
  };
}

export async function patchTenantMember(
  db: Db,
  tenantId: string,
  userId: string,
  role: TenantRole,
) {
  const existing = await getTenantMembership(db, tenantId, userId);
  if (!existing) throw notFound("Member not found");

  if (existing.role === "owner" && role !== "owner") {
    await assertNotLastOwner(db, tenantId, userId);
  }

  const [updated] = await db
    .update(tenantMemberships)
    .set({ role })
    .where(
      and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)),
    )
    .returning();

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return {
    userId,
    email: user!.email,
    displayName: user!.displayName,
    role: updated!.role as TenantRole,
    joinedAt: toIso(updated!.createdAt)!,
  };
}

async function assertNotLastOwner(db: Db, tenantId: string, userId: string) {
  const [result] = await db
    .select({ c: count() })
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.role, "owner")));
  if ((result?.c ?? 0) <= 1) {
    const [self] = await db
      .select()
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.role, "owner"),
        ),
      )
      .limit(1);
    if (self) {
      throw conflict("Cannot remove or demote the last tenant owner");
    }
  }
}

export async function removeTenantMember(db: Db, tenantId: string, userId: string) {
  const existing = await getTenantMembership(db, tenantId, userId);
  if (!existing) throw notFound("Member not found");
  if (existing.role === "owner") {
    await assertNotLastOwner(db, tenantId, userId);
  }

  // project_memberships cascade via FK on tenant_memberships delete
  await db
    .delete(tenantMemberships)
    .where(
      and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)),
    );
}

export async function countProjectMembershipsForUser(
  db: Db,
  tenantId: string,
  userId: string,
) {
  const [result] = await db
    .select({ c: count() })
    .from(projectMemberships)
    .where(
      and(eq(projectMemberships.tenantId, tenantId), eq(projectMemberships.userId, userId)),
    );
  return result?.c ?? 0;
}

export { projects };
