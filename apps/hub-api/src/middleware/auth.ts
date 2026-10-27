import { createMiddleware } from "hono/factory";
import { verifyAccessToken, type TenantRole } from "@agenthub/auth";
import { eq } from "drizzle-orm";
import { users } from "@agenthub/db";
import type { AppEnv } from "../context.js";
import { AppError, unauthenticated } from "../errors.js";

export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  c.set("principal", null);
  // LLM Proxy authenticates its own session token. An access-token parse would reject it.
  if (c.req.path === "/llm" || c.req.path.startsWith("/llm/")) {
    await next();
    return;
  }
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    await next();
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    await next();
    return;
  }

  if (token.startsWith("st1.")) {
    await next();
    return;
  }

  try {
    const claims = await verifyAccessToken(token, c.get("env").JWT_ACCESS_SECRET);
    const db = c.get("db");
    const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
    if (!user || user.status !== "active") {
      throw unauthenticated("User inactive or missing");
    }
    c.set("principal", {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      handle: user.handle,
      isPlatformAdmin: user.isPlatformAdmin || claims.pa === true,
      tenantId: claims.tid && claims.tid.length > 0 ? claims.tid : null,
      tenantRoles: (claims.troles ?? []) as TenantRole[],
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const name = err instanceof Error ? err.name : "";
    if (name === "JWTExpired") {
      throw new AppError(401, "TOKEN_EXPIRED", "Access token expired");
    }
    throw unauthenticated("Invalid access token");
  }
  await next();
});

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const principal = c.get("principal");
  if (!principal) throw unauthenticated();
  await next();
});

export const requirePlatformAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const principal = c.get("principal");
  if (!principal) throw unauthenticated();
  if (!principal.isPlatformAdmin) {
    throw new AppError(403, "FORBIDDEN", "Platform admin required");
  }
  await next();
});
