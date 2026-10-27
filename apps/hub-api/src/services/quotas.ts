import { and, count, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { agentSessions, tenants, workspaces } from "@agenthub/db";
import { AppError } from "../errors.js";

const ACTIVE_WORKSPACES = [
  "provisioning",
  "seeding",
  "applying",
  "ready",
  "ready_degraded",
  "idle",
];
const LIVE_SESSIONS = ["creating", "active", "busy"];

export function quotaNumber(quota: unknown, key: string, fallback: number): number {
  if (!quota || typeof quota !== "object") return fallback;
  const value = (quota as Record<string, unknown>)[key];
  return typeof value === "number" ? value : fallback;
}

export async function assertSessionQuota(
  db: Db,
  tenantId: string,
  userId: string,
  limit: number,
) {
  const [row] = await db
    .select({ n: count() })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.tenantId, tenantId),
        eq(agentSessions.ownerUserId, userId),
        inArray(agentSessions.status, LIVE_SESSIONS),
      ),
    );
  const used = Number(row?.n ?? 0);
  if (used >= limit) {
    throw new AppError(429, "QUOTA_EXCEEDED", "Concurrent session quota exceeded", {
      details: { quota: "maxConcurrentSessionsPerUser", limit, used },
    });
  }
}

export async function assertWorkspaceQuota(
  db: Db,
  tenantId: string,
  limit: number,
  ignoreWorkspaceId?: string,
) {
  const filters = [eq(workspaces.tenantId, tenantId), inArray(workspaces.status, ACTIVE_WORKSPACES)];
  if (ignoreWorkspaceId) filters.push(ne(workspaces.id, ignoreWorkspaceId));
  const [row] = await db
    .select({ n: count() })
    .from(workspaces)
    .where(and(...filters));
  const used = Number(row?.n ?? 0);
  if (used >= limit) {
    throw new AppError(429, "QUOTA_EXCEEDED", "Active workspace quota exceeded", {
      details: { quota: "maxActiveWorkspaces", limit, used },
    });
  }
}

export async function workspaceLimitOf(db: Db, tenantId: string): Promise<number> {
  const [row] = await db.select({ quota: tenants.quota }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return quotaNumber(row?.quota, "maxActiveWorkspaces", 50);
}
