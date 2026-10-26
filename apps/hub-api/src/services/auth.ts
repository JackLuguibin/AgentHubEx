import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyRefreshToken,
  type TenantRole,
} from "@agenthub/auth";
import type { Db } from "@agenthub/db";
import { users } from "@agenthub/db";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Me } from "@agenthub/domain";
import { AppError, conflict, forbidden, unauthenticated } from "../errors.js";
import { newId } from "../lib/id.js";
import {
  createUser,
  findUserByEmail,
  getTenantMembership,
  listUserTenants,
} from "./users.js";

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;

function refreshKey(familyId: string, jti: string) {
  return `refresh:${familyId}:${jti}`;
}

function familyRevokedKey(familyId: string) {
  return `refresh-family-revoked:${familyId}`;
}

export async function buildMe(
  db: Db,
  user: typeof users.$inferSelect,
  currentTenantId: string | null,
): Promise<Me> {
  const memberships = await listUserTenants(db, user.id);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    handle: user.handle,
    isPlatformAdmin: user.isPlatformAdmin,
    currentTenantId,
    tenants: memberships.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      role: m.role as TenantRole,
      status: m.status as "active" | "suspended",
    })),
  };
}

async function issueTokens(
  db: Db,
  redis: Redis,
  secrets: { access: string; refresh: string },
  user: typeof users.$inferSelect,
  tenantId: string | null,
  familyId?: string,
) {
  let troles: string[] = [];
  let tid = tenantId ?? "";
  if (tenantId) {
    const membership = await getTenantMembership(db, tenantId, user.id);
    if (!membership) throw forbidden("Not a member of tenant");
    troles = [membership.role];
  } else {
    const memberships = await listUserTenants(db, user.id);
    const first = memberships[0];
    if (first) {
      tid = first.id;
      troles = [first.role];
    }
  }

  const fid = familyId ?? newId();
  const accessJti = newId();
  const refreshJti = newId();

  const accessToken = await signAccessToken(
    {
      sub: user.id,
      tid,
      troles,
      pa: user.isPlatformAdmin,
      jti: accessJti,
    },
    secrets.access,
    `${ACCESS_TTL_SEC}s`,
  );

  const refreshToken = await signRefreshToken(
    {
      sub: user.id,
      tid,
      fid,
      jti: refreshJti,
    },
    secrets.refresh,
    `${REFRESH_TTL_SEC}s`,
  );

  await redis.set(refreshKey(fid, refreshJti), "1", "EX", REFRESH_TTL_SEC);

  const me = await buildMe(db, user, tid || null);
  return {
    accessToken,
    expiresIn: ACCESS_TTL_SEC,
    refreshToken,
    user: me,
    familyId: fid,
  };
}

export async function registerUser(
  db: Db,
  redis: Redis,
  secrets: { access: string; refresh: string },
  input: { email: string; password: string; displayName: string; handle: string },
) {
  const user = await createUser(db, {
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    handle: input.handle,
  });
  return issueTokens(db, redis, secrets, user, null);
}

export async function loginUser(
  db: Db,
  redis: Redis,
  secrets: { access: string; refresh: string },
  input: { email: string; password: string },
) {
  const user = await findUserByEmail(db, input.email);
  if (!user || !user.passwordHash) throw unauthenticated("Invalid email or password");
  if (user.status !== "active") throw forbidden("Account disabled");

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw unauthenticated("Invalid email or password");

  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return issueTokens(db, redis, secrets, user, null);
}

export async function refreshSession(
  db: Db,
  redis: Redis,
  secrets: { access: string; refresh: string },
  refreshToken: string,
) {
  let claims;
  try {
    claims = await verifyRefreshToken(refreshToken, secrets.refresh);
  } catch {
    throw unauthenticated("Invalid refresh token");
  }

  if (!claims.sub || !claims.jti || !claims.fid) {
    throw unauthenticated("Invalid refresh token");
  }

  const revoked = await redis.get(familyRevokedKey(claims.fid));
  if (revoked) throw unauthenticated("Refresh family revoked");

  const active = await redis.get(refreshKey(claims.fid, claims.jti));
  if (!active) {
    await redis.set(familyRevokedKey(claims.fid), "1", "EX", REFRESH_TTL_SEC);
    throw unauthenticated("Refresh token reuse detected");
  }

  await redis.del(refreshKey(claims.fid, claims.jti));

  const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  if (!user || user.status !== "active") throw unauthenticated("User inactive");

  return issueTokens(db, redis, secrets, user, claims.tid || null, claims.fid);
}

export async function logoutSession(redis: Redis, refreshToken: string | undefined, refreshSecret: string) {
  if (!refreshToken) return;
  try {
    const claims = await verifyRefreshToken(refreshToken, refreshSecret);
    if (claims.fid && claims.jti) {
      await redis.del(refreshKey(claims.fid, claims.jti));
      await redis.set(familyRevokedKey(claims.fid), "1", "EX", REFRESH_TTL_SEC);
    }
  } catch {
    // ignore invalid cookie
  }
}

export async function switchTenant(
  db: Db,
  redis: Redis,
  secrets: { access: string; refresh: string },
  userId: string,
  tenantId: string,
) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw unauthenticated();
  const membership = await getTenantMembership(db, tenantId, userId);
  if (!membership) throw forbidden("Not a member of tenant");
  return issueTokens(db, redis, secrets, user, tenantId);
}

export async function ensurePasswordHash(password: string): Promise<string> {
  return hashPassword(password);
}

export function assertUniqueEmailConflict(err: unknown): never {
  throw conflict("Email already registered");
}

export { ACCESS_TTL_SEC };

export function mapJoseError(err: unknown): AppError {
  if (err instanceof Error && err.name === "JWTExpired") {
    return new AppError(401, "TOKEN_EXPIRED", "Token expired");
  }
  return unauthenticated("Invalid token");
}
