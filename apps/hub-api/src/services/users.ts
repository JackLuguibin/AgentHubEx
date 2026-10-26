import { and, eq } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { tenantMemberships, tenants, users } from "@agenthub/db";
import { hashPassword } from "@agenthub/auth";
import { newId } from "../lib/id.js";
import { conflict, notFound } from "../errors.js";

export async function findUserByEmail(db: Db, email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}

export async function createUser(
  db: Db,
  input: {
    email: string;
    displayName: string;
    handle: string;
    password?: string;
    isPlatformAdmin?: boolean;
  },
) {
  const existingEmail = await findUserByEmail(db, input.email);
  if (existingEmail) throw conflict("Email already registered");

  const [existingHandle] = await db
    .select()
    .from(users)
    .where(eq(users.handle, input.handle))
    .limit(1);
  if (existingHandle) throw conflict("Handle already taken");

  const id = newId();
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const [row] = await db
    .insert(users)
    .values({
      id,
      email: input.email,
      displayName: input.displayName,
      handle: input.handle,
      passwordHash,
      isPlatformAdmin: input.isPlatformAdmin ?? false,
    })
    .returning();
  if (!row) throw new Error("failed to insert user");
  return row;
}

/** Find by email or create a placeholder local user (no password) for invitations. */
export async function findOrCreateUserByEmail(
  db: Db,
  email: string,
  displayName?: string,
) {
  const existing = await findUserByEmail(db, email);
  if (existing) return existing;

  const local = email.split("@")[0] ?? "user";
  const baseHandle = local
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "user";

  for (let i = 0; i < 8; i++) {
    const handle = i === 0 ? baseHandle : `${baseHandle}-${i + 1}`;
    try {
      return await createUser(db, {
        email,
        displayName: displayName ?? local,
        handle: handle.length >= 2 ? handle : `u-${handle}`,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Handle")) continue;
      // email race
      const again = await findUserByEmail(db, email);
      if (again) return again;
      throw err;
    }
  }
  throw conflict("Unable to allocate handle for email");
}

export async function getUserOrThrow(db: Db, userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw notFound("User not found");
  return row;
}

export async function listUserTenants(db: Db, userId: string) {
  return db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      role: tenantMemberships.role,
      status: tenants.status,
    })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(eq(tenantMemberships.userId, userId));
}

export async function getTenantMembership(db: Db, tenantId: string, userId: string) {
  const [row] = await db
    .select()
    .from(tenantMemberships)
    .where(
      and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)),
    )
    .limit(1);
  return row ?? null;
}
