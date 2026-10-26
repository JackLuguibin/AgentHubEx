import { and, eq } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { runtimeInstances } from "@agenthub/db";
import { can } from "@agenthub/auth";
import type { RuntimeInstance } from "@agenthub/domain";
import { forbidden, notFound } from "../errors.js";
import { encryptSecret } from "../lib/crypto.js";
import { newId } from "../lib/id.js";
import { toIso } from "../lib/time.js";
import { requireTenantAdmin, requireTenantMember } from "./tenants.js";

function mapInstance(
  row: typeof runtimeInstances.$inferSelect,
  includeBaseUrl: boolean,
): RuntimeInstance {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode as RuntimeInstance["mode"],
    runtimeType: row.runtimeType as RuntimeInstance["runtimeType"],
    baseUrl: includeBaseUrl ? row.baseUrl : undefined,
    isolation: row.isolation as RuntimeInstance["isolation"],
    labels: (row.labels ?? {}) as Record<string, string>,
    health: row.healthStatus as RuntimeInstance["health"],
    latencyMs: row.latencyMs,
    upstreamVersion: row.upstreamVersion,
    hasSyncAgent: row.hasSyncAgent,
    maxSessions: row.maxSessions,
    assignedProjectIds: row.assignedProjectIds ?? [],
    lastCheckedAt: toIso(row.lastCheckedAt),
    createdAt: toIso(row.createdAt)!,
  };
}

export async function listInstances(
  db: Db,
  tenantId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  await requireTenantMember(db, tenantId, userId, isPlatformAdmin);
  const canManage = can(null, isPlatformAdmin ? "owner" : (await requireTenantMember(db, tenantId, userId, isPlatformAdmin)).role, "instance.manage", {
    isPlatformAdmin,
  });
  const rows = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.tenantId, tenantId));
  return {
    items: rows.map((r) => mapInstance(r, canManage)),
    nextCursor: null as string | null,
  };
}

export async function registerInstance(
  db: Db,
  tenantId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  input: {
    name: string;
    runtimeType: "opencode" | "claude";
    baseUrl: string;
    tlsVerify?: boolean;
    auth?: { username: string; password: string };
    isolation?: "dedicated" | "shared";
    labels?: Record<string, string>;
    maxSessions?: number;
    assignedProjectIds?: string[];
    workdirHint?: string;
  },
) {
  const membership = await requireTenantAdmin(db, tenantId, userId, isPlatformAdmin);
  if (!can(null, membership.role, "instance.manage", { isPlatformAdmin })) {
    throw forbidden();
  }

  const id = newId();
  const [row] = await db
    .insert(runtimeInstances)
    .values({
      id,
      tenantId,
      name: input.name,
      mode: "external",
      runtimeType: input.runtimeType,
      baseUrl: input.baseUrl,
      tlsVerify: input.tlsVerify ?? true,
      authUsername: input.auth?.username,
      authSecretCiphertext: input.auth
        ? encryptSecret(input.auth.password, platformDek)
        : null,
      authKeyVersion: input.auth ? 1 : null,
      isolation: input.isolation ?? "dedicated",
      labels: input.labels ?? {},
      healthStatus: "pending",
      maxSessions: input.maxSessions,
      assignedProjectIds: input.assignedProjectIds ?? [],
      workdirHint: input.workdirHint,
    })
    .returning();

  return mapInstance(row!, true);
}

export async function getInstance(
  db: Db,
  instanceId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const [row] = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.id, instanceId))
    .limit(1);
  if (!row || !row.tenantId) throw notFound("Instance not found");
  const membership = await requireTenantMember(db, row.tenantId, userId, isPlatformAdmin);
  const canManage = can(null, membership.role, "instance.manage", { isPlatformAdmin });
  return mapInstance(row, canManage);
}

export async function deleteInstance(
  db: Db,
  instanceId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const [row] = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.id, instanceId))
    .limit(1);
  if (!row || !row.tenantId) throw notFound("Instance not found");
  await requireTenantAdmin(db, row.tenantId, userId, isPlatformAdmin);
  await db
    .delete(runtimeInstances)
    .where(and(eq(runtimeInstances.id, instanceId), eq(runtimeInstances.tenantId, row.tenantId)));
}
