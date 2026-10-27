import { and, count, eq, inArray } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import {
  projectRuntimeBindings,
  projects,
  runtimeInstances,
  workspaces,
} from "@agenthub/db";
import { can } from "@agenthub/auth";
import { opencodeAdapter } from "@agenthub/adapter-opencode";
import type {
  PatchInstanceReq,
  ProjectRuntimeBinding,
  PutProjectBindingsReq,
  RuntimeInstance,
  TestInstanceReq,
  TestInstanceRes,
} from "@agenthub/domain";
import type { InstanceCtx } from "@agenthub/runtime-contract";
import { AppError, conflict, forbidden, notFound } from "../errors.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { newId } from "../lib/id.js";
import { toIso } from "../lib/time.js";
import { resolveProjectAccess } from "./projects.js";
import { requireTenantAdmin, requireTenantMember } from "./tenants.js";

function mapInstance(
  row: typeof runtimeInstances.$inferSelect,
  includeBaseUrl: boolean,
  extras?: { boundProjectCount?: number; workspaceCount?: number },
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
    ...(extras?.boundProjectCount != null
      ? { boundProjectCount: extras.boundProjectCount }
      : {}),
    ...(extras?.workspaceCount != null
      ? { workspaceCount: extras.workspaceCount }
      : {}),
  } as RuntimeInstance;
}

function rowToCtx(
  row: typeof runtimeInstances.$inferSelect,
  platformDek: string,
): InstanceCtx {
  let auth: InstanceCtx["auth"];
  if (row.authUsername && row.authSecretCiphertext) {
    auth = {
      username: row.authUsername,
      password: decryptSecret(Buffer.from(row.authSecretCiphertext), platformDek),
    };
  }
  return {
    baseUrl: row.baseUrl,
    auth,
    tlsVerify: row.tlsVerify,
    mock: row.baseUrl.startsWith("mock://"),
  };
}

function assertIsolationAllowed(
  isolation: "dedicated" | "shared" | undefined,
  deploymentProfile: string,
) {
  const profile = deploymentProfile || "intranet";
  if (
    isolation === "shared" &&
    (profile === "intranet" || profile === "airgap")
  ) {
    throw conflict(
      "Shared isolation is not allowed in intranet/airgap deployments (ADR-013)",
    );
  }
}

async function writeHealth(
  db: Db,
  instanceId: string,
  result: { ok: boolean; latencyMs?: number; version?: string },
) {
  const [current] = await db
    .select({ healthFailCount: runtimeInstances.healthFailCount })
    .from(runtimeInstances)
    .where(eq(runtimeInstances.id, instanceId))
    .limit(1);
  const healthStatus = result.ok ? "healthy" : "unhealthy";
  const [updated] = await db
    .update(runtimeInstances)
    .set({
      healthStatus,
      latencyMs: result.latencyMs ?? null,
      upstreamVersion: result.version ?? null,
      healthFailCount: result.ok ? 0 : (current?.healthFailCount ?? 0) + 1,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(runtimeInstances.id, instanceId))
    .returning();
  return updated!;
}

export async function probeUpstream(
  platformDek: string,
  input: {
    baseUrl: string;
    tlsVerify?: boolean;
    auth?: { username: string; password: string };
  },
): Promise<TestInstanceRes> {
  const ctx: InstanceCtx = {
    baseUrl: input.baseUrl,
    tlsVerify: input.tlsVerify ?? true,
    auth: input.auth,
    mock: input.baseUrl.startsWith("mock://"),
  };
  try {
    const health = await opencodeAdapter.health(ctx);
    return {
      ok: health.ok,
      latencyMs: health.latencyMs,
      version: health.version,
      error: health.ok ? undefined : "Upstream health check failed",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Upstream unreachable",
    };
  }
}

export async function listInstances(
  db: Db,
  tenantId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  await requireTenantMember(db, tenantId, userId, isPlatformAdmin);
  const membership = await requireTenantMember(db, tenantId, userId, isPlatformAdmin);
  const canManage = can(null, membership.role, "instance.manage", { isPlatformAdmin });
  const rows = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.tenantId, tenantId));

  const items: RuntimeInstance[] = [];
  for (const r of rows) {
    const [bound] = await db
      .select({ c: count() })
      .from(projectRuntimeBindings)
      .where(eq(projectRuntimeBindings.instanceId, r.id));
    const [ws] = await db
      .select({ c: count() })
      .from(workspaces)
      .where(eq(workspaces.instanceId, r.id));
    items.push(
      mapInstance(r, canManage, {
        boundProjectCount: Number(bound?.c ?? 0),
        workspaceCount: Number(ws?.c ?? 0),
      }),
    );
  }
  return { items, nextCursor: null as string | null };
}

export async function testInstanceConnection(
  db: Db,
  tenantId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  input: TestInstanceReq,
): Promise<TestInstanceRes> {
  await requireTenantAdmin(db, tenantId, userId, isPlatformAdmin);
  return probeUpstream(platformDek, input);
}

export async function registerInstance(
  db: Db,
  tenantId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  deploymentProfile: string,
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

  const isolation = input.isolation ?? "dedicated";
  assertIsolationAllowed(isolation, deploymentProfile);

  if (input.assignedProjectIds?.length) {
    const rows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.tenantId, tenantId),
          inArray(projects.id, input.assignedProjectIds),
        ),
      );
    if (rows.length !== input.assignedProjectIds.length) {
      throw conflict("assignedProjectIds must belong to the tenant");
    }
  }

  const probe = await probeUpstream(platformDek, input);

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
      isolation,
      labels: input.labels ?? {},
      healthStatus: probe.ok ? "healthy" : "unhealthy",
      latencyMs: probe.latencyMs ?? null,
      upstreamVersion: probe.version ?? null,
      lastCheckedAt: new Date(),
      maxSessions: input.maxSessions,
      assignedProjectIds: input.assignedProjectIds ?? [],
      workdirHint: input.workdirHint,
    })
    .returning();

  // Auto-bind assigned projects for the registered runtime type
  for (const projectId of input.assignedProjectIds ?? []) {
    await db.insert(projectRuntimeBindings).values({
      id: newId(),
      tenantId,
      projectId,
      runtimeType: input.runtimeType,
      instanceId: id,
      priority: 100,
    });
  }

  return mapInstance(row!, true, {
    boundProjectCount: input.assignedProjectIds?.length ?? 0,
    workspaceCount: 0,
  });
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

export async function patchInstance(
  db: Db,
  instanceId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  deploymentProfile: string,
  patch: PatchInstanceReq,
) {
  const [row] = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.id, instanceId))
    .limit(1);
  if (!row || !row.tenantId) throw notFound("Instance not found");
  await requireTenantAdmin(db, row.tenantId, userId, isPlatformAdmin);

  if (patch.isolation) {
    assertIsolationAllowed(patch.isolation, deploymentProfile);
  }

  let healthStatus = row.healthStatus;
  if (patch.enabled === false) healthStatus = "disabled";
  if (patch.enabled === true && row.healthStatus === "disabled") {
    healthStatus = "pending";
  }

  const [updated] = await db
    .update(runtimeInstances)
    .set({
      name: patch.name ?? row.name,
      baseUrl: patch.baseUrl ?? row.baseUrl,
      tlsVerify: patch.tlsVerify ?? row.tlsVerify,
      authUsername: patch.auth?.username ?? row.authUsername,
      authSecretCiphertext: patch.auth
        ? encryptSecret(patch.auth.password, platformDek)
        : row.authSecretCiphertext,
      authKeyVersion: patch.auth ? 1 : row.authKeyVersion,
      isolation: patch.isolation ?? row.isolation,
      labels: patch.labels ?? row.labels,
      maxSessions:
        patch.maxSessions === undefined ? row.maxSessions : patch.maxSessions,
      assignedProjectIds: patch.assignedProjectIds ?? row.assignedProjectIds,
      workdirHint:
        patch.workdirHint === undefined ? row.workdirHint : patch.workdirHint,
      healthStatus,
      updatedAt: new Date(),
    })
    .where(eq(runtimeInstances.id, instanceId))
    .returning();

  return mapInstance(updated!, true);
}

export async function probeInstance(
  db: Db,
  instanceId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
) {
  const [row] = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.id, instanceId))
    .limit(1);
  if (!row || !row.tenantId) throw notFound("Instance not found");
  await requireTenantAdmin(db, row.tenantId, userId, isPlatformAdmin);

  if (row.healthStatus === "disabled") {
    throw conflict("Instance is disabled");
  }

  const result = await probeUpstream(platformDek, {
    baseUrl: row.baseUrl,
    tlsVerify: row.tlsVerify,
    auth:
      row.authUsername && row.authSecretCiphertext
        ? {
            username: row.authUsername,
            password: decryptSecret(Buffer.from(row.authSecretCiphertext), platformDek),
          }
        : undefined,
  });

  const updated = await writeHealth(db, instanceId, result);
  return mapInstance(updated, true);
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

  const [ws] = await db
    .select({ c: count() })
    .from(workspaces)
    .where(eq(workspaces.instanceId, instanceId));
  if (Number(ws?.c ?? 0) > 0) {
    throw new AppError(409, "INSTANCE_IN_USE", "Instance still has workspaces", {
      details: { workspaceCount: Number(ws?.c ?? 0) },
    });
  }

  await db
    .delete(runtimeInstances)
    .where(and(eq(runtimeInstances.id, instanceId), eq(runtimeInstances.tenantId, row.tenantId)));
}

export async function listProjectBindings(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
): Promise<{ bindings: ProjectRuntimeBinding[] }> {
  await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  const rows = await db
    .select()
    .from(projectRuntimeBindings)
    .where(eq(projectRuntimeBindings.projectId, projectId));
  return {
    bindings: rows.map((r) => ({
      id: r.id,
      runtimeType: r.runtimeType as ProjectRuntimeBinding["runtimeType"],
      instanceId: r.instanceId ?? undefined,
      labelSelector: (r.labelSelector as Record<string, string> | null) ?? undefined,
      priority: r.priority,
    })),
  };
}

export async function putProjectBindings(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
  input: PutProjectBindingsReq,
): Promise<{ bindings: ProjectRuntimeBinding[] }> {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "binding.manage", { isPlatformAdmin })) {
    throw forbidden();
  }

  for (const b of input.bindings) {
    if (b.instanceId) {
      const [inst] = await db
        .select()
        .from(runtimeInstances)
        .where(eq(runtimeInstances.id, b.instanceId))
        .limit(1);
      if (!inst || inst.tenantId !== access.project.tenantId) {
        throw notFound(`Instance ${b.instanceId} not found in tenant`);
      }
    }
  }

  await db
    .delete(projectRuntimeBindings)
    .where(eq(projectRuntimeBindings.projectId, projectId));

  const created: ProjectRuntimeBinding[] = [];
  for (const b of input.bindings) {
    const id = newId();
    const [row] = await db
      .insert(projectRuntimeBindings)
      .values({
        id,
        tenantId: access.project.tenantId,
        projectId,
        runtimeType: b.runtimeType,
        instanceId: b.instanceId,
        labelSelector: b.labelSelector ?? null,
        priority: b.priority ?? 100,
      })
      .returning();
    created.push({
      id: row!.id,
      runtimeType: row!.runtimeType as ProjectRuntimeBinding["runtimeType"],
      instanceId: row!.instanceId ?? undefined,
      labelSelector:
        (row!.labelSelector as Record<string, string> | null) ?? undefined,
      priority: row!.priority,
    });
  }
  return { bindings: created };
}

/** Periodic health sweep over external instances; disabled instances are skipped. */
export async function probeAllInstances(db: Db, platformDek: string) {
  const rows = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.mode, "external"));
  for (const row of rows) {
    if (row.healthStatus === "disabled") continue;
    const ctx = rowToCtx(row, platformDek);
    const result = await probeUpstream(platformDek, ctx);
    await writeHealth(db, row.id, result);
  }
}

/** Block config apply when instance is offline / disabled. */
export async function assertInstanceHealthyForConfig(
  db: Db,
  instanceId: string,
) {
  const [row] = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.id, instanceId))
    .limit(1);
  if (!row) throw notFound("Instance not found");
  if (
    row.healthStatus === "unhealthy" ||
    row.healthStatus === "disabled" ||
    row.healthStatus === "pending"
  ) {
    throw conflict(
      "Instance is offline or not ready; config apply is blocked",
      { health: row.healthStatus },
    );
  }
  return row;
}

export { rowToCtx as instanceRowToCtx };
