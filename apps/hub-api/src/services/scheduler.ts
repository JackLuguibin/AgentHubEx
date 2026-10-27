import { randomBytes } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { nodes, projectRuntimeBindings, runtimeInstances, workspaces } from "@agenthub/db";
import { can } from "@agenthub/auth";
import { DEFAULT_CAPABILITIES } from "@agenthub/runtime-contract";
import { AppError, forbidden, notFound } from "../errors.js";
import { recordAudit } from "../lib/audit.js";
import { encryptSecret } from "../lib/crypto.js";
import { ensureNodeCa } from "../lib/node-ca.js";
import type { HubRuntime } from "../lib/hub-runtime.js";
import { newId } from "../lib/id.js";
import { toIso } from "../lib/time.js";
import {
  asCapacity,
  asLabels,
  asResources,
  rankNodes,
  wantsManagedDelivery,
  workspaceSpecOf,
  type SchedNode,
} from "../lib/schedule.js";
import { callNode, type NodeTls } from "./node-client.js";
import { assertWorkspaceQuota, workspaceLimitOf } from "./quotas.js";
import { resolveProjectAccess } from "./projects.js";

type InstanceRow = typeof runtimeInstances.$inferSelect;
type WorkspaceRow = typeof workspaces.$inferSelect;

async function clientTls(runtime: HubRuntime): Promise<NodeTls> {
  const ca = await ensureNodeCa(runtime.nodeCaDir);
  return { cert: ca.hubClientCert, key: ca.hubClientKey, ca: ca.caPem };
}

async function loadSnapshots(db: Db, redis: HubRuntime["redis"]): Promise<Array<SchedNode & { address: string }>> {
  const rows = await db.select().from(nodes);
  const snaps: Array<SchedNode & { address: string }> = [];
  for (const row of rows) {
    let preclaim = asResources({});
    try {
      preclaim = asResources(JSON.parse((await redis.get(`node:preclaim:${row.id}`)) || "{}"));
    } catch {
      preclaim = asResources({});
    }
    const used = asResources(row.used);
    const capacity = asCapacity(row.capacity);
    snaps.push({
      id: row.id,
      status: row.status,
      labels: asLabels(row.labels),
      lastHeartbeatAtMs: row.lastHeartbeatAt ? row.lastHeartbeatAt.getTime() : null,
      agentHealth: asLabels(row.labels).agentHealth === "degraded" ? "degraded" : "ok",
      capacity,
      used: {
        cpu: used.cpu + preclaim.cpu,
        memMb: used.memMb + preclaim.memMb,
        diskGb: used.diskGb + preclaim.diskGb,
        workspaces: used.workspaces + preclaim.workspaces,
      },
      address: row.internalAddress,
    });
  }
  return snaps;
}

async function withNodeLock<T>(
  redis: HubRuntime["redis"],
  nodeId: string,
  owner: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const key = `lock:node:${nodeId}`;
  const ok = await redis.set(key, owner, "EX", 90, "NX");
  if (ok !== "OK") return null;
  try {
    return await fn();
  } finally {
    const current = await redis.get(key);
    if (current === owner) await redis.del(key);
  }
}

async function reserve(redis: HubRuntime["redis"], nodeId: string, spec: { cpu: number; memMb: number; diskGb: number }, sign: 1 | -1) {
  const key = `node:preclaim:${nodeId}`;
  const current = asResources(JSON.parse((await redis.get(key)) || "{}"));
  const next = {
    cpu: Math.max(0, current.cpu + sign * spec.cpu),
    memMb: Math.max(0, current.memMb + sign * spec.memMb),
    diskGb: Math.max(0, current.diskGb + sign * spec.diskGb),
    workspaces: Math.max(0, current.workspaces + sign),
  };
  await redis.set(key, JSON.stringify(next), "EX", 90);
}

function specOf(row: WorkspaceRow): { cpu: number; memMb: number; diskGb: number; nodeId?: string } {
  const value = asResources(row.spec);
  const record = row.spec && typeof row.spec === "object" ? (row.spec as Record<string, unknown>) : {};
  return {
    cpu: value.cpu || 2,
    memMb: value.memMb || 4096,
    diskGb: value.diskGb || 20,
    nodeId: typeof record.nodeId === "string" ? record.nodeId : undefined,
  };
}

async function findWorkspace(db: Db, projectId: string, userId: string, runtimeType: string) {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.projectId, projectId),
        eq(workspaces.ownerUserId, userId),
        eq(workspaces.runtimeType, runtimeType),
        ne(workspaces.status, "deleted"),
      ),
    )
    .limit(1);
  return row;
}

function noCapacity(workspaceId: string): AppError {
  return new AppError(409, "WORKSPACE_NOT_READY", "No node has capacity for this workspace", {
    details: { reason: "NO_CAPACITY", retryAfter: 15, workspaceId },
  });
}

export async function provisionManagedWorkspace(
  db: Db,
  runtime: HubRuntime,
  input: {
    tenantId: string;
    projectId: string;
    userId: string;
    runtimeType: "opencode" | "claude";
    selector: Record<string, string>;
    spec: { cpu: number; memMb: number; diskGb: number };
  },
): Promise<{ instance: InstanceRow; workspace: WorkspaceRow }> {
  const existing = await findWorkspace(db, input.projectId, input.userId, input.runtimeType);
  if (existing?.status === "revoked") throw new AppError(409, "WORKSPACE_NOT_READY", "Workspace was revoked");
  if (existing && (existing.status === "ready" || existing.status === "ready_degraded") && existing.instanceId) {
    await db
      .update(workspaces)
      .set({ lastActiveAt: new Date(), updatedAt: new Date() })
      .where(eq(workspaces.id, existing.id));
    const [instance] = await db.select().from(runtimeInstances).where(eq(runtimeInstances.id, existing.instanceId)).limit(1);
    if (instance) return { instance, workspace: { ...existing, lastActiveAt: new Date() } };
  }
  if (existing && (existing.status === "idle" || existing.status === "stopped") && existing.instanceId) {
    const started = await resumeWorkspace(db, runtime, existing);
    if (started) return started;
  }

  const limit = await workspaceLimitOf(db, input.tenantId);
  await assertWorkspaceQuota(db, input.tenantId, limit, existing?.id);
  const workspaceId = existing?.id ?? newId();
  if (!existing) {
    await db.insert(workspaces).values({
      id: workspaceId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      ownerUserId: input.userId,
      kind: "personal",
      runtimeType: input.runtimeType,
      status: "provisioning",
      spec: input.spec,
      lastActiveAt: new Date(),
    });
  } else {
    await db
      .update(workspaces)
      .set({ status: "provisioning", statusReason: null, spec: input.spec, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
  }

  const tls = await clientTls(runtime);
  const now = Date.now();
  const sticky = existing?.volumePath ? specOf(existing).nodeId : undefined;
  const ranked = (await loadSnapshots(db, runtime.redis)).filter((node) => node.address.startsWith("https://"));
  const ordered = rankNodes(ranked, input.spec, { now, selector: input.selector, stickyNodeId: sticky });
  if (ordered.length === 0) {
    await db
      .update(workspaces)
      .set({ status: "failed", statusReason: "NO_CAPACITY", updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
    throw noCapacity(workspaceId);
  }

  let lastError: unknown;
  for (const candidate of ordered) {
    let placed: { instance: InstanceRow; workspace: WorkspaceRow } | null = null;
    try {
      placed = await withNodeLock(runtime.redis, candidate.id, workspaceId, async () => {
      await reserve(runtime.redis, candidate.id, input.spec, 1);
      try {
        const bootToken = randomBytes(24).toString("base64url");
        const created = (await callNode(candidate.address, "/workspaces", tls, {
          method: "POST",
          body: {
            workspaceId,
            tenantId: input.tenantId,
            projectId: input.projectId,
            userId: input.userId,
            runtimeType: input.runtimeType,
            image:
              input.runtimeType === "claude" ? runtime.workerImages.claude : runtime.workerImages.opencode,
            resources: input.spec,
            bootToken,
          },
        })) as { endpoint: string; authSecret?: string; volumePath?: string; containerId?: string };
        const instanceId = newId();
        const secret = created.authSecret || bootToken;
        const [instance] = await db
          .insert(runtimeInstances)
          .values({
            id: instanceId,
            tenantId: input.tenantId,
            nodeId: candidate.id,
            name: `managed-${workspaceId.slice(0, 8)}`,
            mode: "managed",
            runtimeType: input.runtimeType,
            baseUrl: created.endpoint,
            tlsVerify: created.endpoint.startsWith("https://"),
            authUsername: "agenthub",
            authSecretCiphertext: encryptSecret(secret, runtime.platformDek),
            authKeyVersion: 1,
            isolation: "dedicated",
            labels: { managed: "true" },
            healthStatus: "healthy",
            assignedProjectIds: [input.projectId],
            lastCheckedAt: new Date(),
          })
          .returning();
        const [workspace] = await db
          .update(workspaces)
          .set({
            status: "ready",
            statusReason: null,
            instanceId,
            volumePath: created.volumePath ?? null,
            spec: { ...input.spec, nodeId: candidate.id, containerId: created.containerId ?? null },
            lastActiveAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(workspaces.id, workspaceId))
          .returning();
        const [node] = await db.select().from(nodes).where(eq(nodes.id, candidate.id)).limit(1);
        if (node) {
          const used = asResources(node.used);
          await db
            .update(nodes)
            .set({
              used: {
                cpu: used.cpu + input.spec.cpu,
                memMb: used.memMb + input.spec.memMb,
                diskGb: used.diskGb + input.spec.diskGb,
                workspaces: used.workspaces + 1,
              },
              updatedAt: new Date(),
            })
            .where(eq(nodes.id, node.id));
        }
        recordAudit({
          action: "workspace.provision",
          actorId: input.userId,
          tenantId: input.tenantId,
          projectId: input.projectId,
          targetType: "workspace",
          targetId: workspaceId,
          meta: { nodeId: candidate.id, mode: "managed" },
        });
        if (!instance || !workspace) throw new Error("failed to store managed workspace");
        return { instance, workspace };
      } finally {
        await reserve(runtime.redis, candidate.id, input.spec, -1);
      }
      });
    } catch (err) {
      lastError = err;
      continue;
    }
    if (placed) return placed;
  }
  await db
    .update(workspaces)
    .set({
      status: "failed",
      statusReason: lastError instanceof Error ? lastError.message : "NO_CAPACITY",
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));
  if (lastError instanceof AppError) throw lastError;
  throw noCapacity(workspaceId);
}

async function resumeWorkspace(
  db: Db,
  runtime: HubRuntime,
  workspace: WorkspaceRow,
): Promise<{ instance: InstanceRow; workspace: WorkspaceRow } | null> {
  if (!workspace.instanceId) return null;
  const [instance] = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.id, workspace.instanceId))
    .limit(1);
  if (!instance?.nodeId) return null;
  const [node] = await db.select().from(nodes).where(eq(nodes.id, instance.nodeId)).limit(1);
  if (!node?.internalAddress.startsWith("https://")) return null;
  const tls = await clientTls(runtime);
  try {
    await callNode(node.internalAddress, `/workspaces/${workspace.id}/start`, tls, { method: "POST", body: {} });
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== "WORKSPACE_NOT_FOUND") throw err;
    return null;
  }
  const [updated] = await db
    .update(workspaces)
    .set({ status: "ready", statusReason: null, lastActiveAt: new Date(), updatedAt: new Date() })
    .where(eq(workspaces.id, workspace.id))
    .returning();
  return { instance, workspace: updated! };
}

export async function resolveManagedDecision(
  db: Db,
  projectId: string,
  runtimeType: string,
  settings: unknown,
) {
  const bindings = await db
    .select()
    .from(projectRuntimeBindings)
    .where(
      and(eq(projectRuntimeBindings.projectId, projectId), eq(projectRuntimeBindings.runtimeType, runtimeType)),
    )
    .orderBy(asc(projectRuntimeBindings.priority));
  return {
    bindings,
    decision: wantsManagedDelivery(
      settings,
      bindings.map((binding) => ({ instanceId: binding.instanceId, labelSelector: binding.labelSelector })),
    ),
    spec: workspaceSpecOf(settings),
  };
}

async function loadOwned(db: Db, workspaceId: string, userId: string, isPlatformAdmin: boolean) {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), ne(workspaces.status, "deleted")))
    .limit(1);
  if (!ws) throw notFound("Workspace not found");
  if (ws.ownerUserId !== userId && !isPlatformAdmin) throw notFound("Workspace not found");
  const access = await resolveProjectAccess(db, ws.projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "workspace.own", { isPlatformAdmin })) throw forbidden();
  return ws;
}

function dto(ws: WorkspaceRow, instance: InstanceRow | null) {
  return {
    id: ws.id,
    projectId: ws.projectId,
    ownerUserId: ws.ownerUserId,
    runtimeType: ws.runtimeType as "opencode" | "claude",
    status: ws.status,
    statusReason: ws.statusReason,
    mode: (instance?.mode ?? "external") as "external" | "managed",
    instance: instance
      ? {
          id: instance.id,
          name: instance.name,
          health: instance.healthStatus as "pending" | "healthy" | "degraded" | "unhealthy" | "disabled",
        }
      : null,
    capabilities: DEFAULT_CAPABILITIES,
    createdAt: toIso(ws.createdAt)!,
  };
}

export async function startOwnedWorkspace(
  db: Db,
  runtime: HubRuntime,
  workspaceId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const ws = await loadOwned(db, workspaceId, userId, isPlatformAdmin);
  if (ws.instanceId) {
    const [instance] = await db.select().from(runtimeInstances).where(eq(runtimeInstances.id, ws.instanceId)).limit(1);
    if (instance?.mode === "managed" && instance.nodeId) {
      const [node] = await db.select().from(nodes).where(eq(nodes.id, instance.nodeId)).limit(1);
      if (node?.internalAddress.startsWith("https://")) {
        const tls = await clientTls(runtime);
        await callNode(node.internalAddress, `/workspaces/${ws.id}/start`, tls, { method: "POST", body: {} });
      }
    }
  }
  const [updated] = await db
    .update(workspaces)
    .set({ status: "ready", statusReason: null, lastActiveAt: new Date(), updatedAt: new Date() })
    .where(eq(workspaces.id, ws.id))
    .returning();
  const [instance] = updated?.instanceId
    ? await db.select().from(runtimeInstances).where(eq(runtimeInstances.id, updated.instanceId)).limit(1)
    : [undefined];
  return dto(updated!, instance ?? null);
}

export async function stopOwnedWorkspace(
  db: Db,
  runtime: HubRuntime,
  workspaceId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const ws = await loadOwned(db, workspaceId, userId, isPlatformAdmin);
  let instance: InstanceRow | null = null;
  if (ws.instanceId) {
    const [row] = await db.select().from(runtimeInstances).where(eq(runtimeInstances.id, ws.instanceId)).limit(1);
    instance = row ?? null;
    if (instance?.mode === "managed" && instance.nodeId) {
      const [node] = await db.select().from(nodes).where(eq(nodes.id, instance.nodeId)).limit(1);
      if (node?.internalAddress.startsWith("https://")) {
        const tls = await clientTls(runtime);
        await callNode(node.internalAddress, `/workspaces/${ws.id}/stop`, tls, { method: "POST", body: {} });
        const spec = specOf(ws);
        const used = asResources(node.used);
        await db
          .update(nodes)
          .set({
            used: {
              cpu: Math.max(0, used.cpu - spec.cpu),
              memMb: Math.max(0, used.memMb - spec.memMb),
              diskGb: used.diskGb,
              workspaces: used.workspaces,
            },
            updatedAt: new Date(),
          })
          .where(eq(nodes.id, node.id));
      }
    }
  }
  const [updated] = await db
    .update(workspaces)
    .set({ status: "stopped", statusReason: "stopped", lastActiveAt: ws.lastActiveAt, updatedAt: new Date() })
    .where(eq(workspaces.id, ws.id))
    .returning();
  return dto(updated!, instance);
}
