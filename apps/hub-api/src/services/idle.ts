import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { nodes, runtimeInstances, workspaces } from "@agenthub/db";
import { ensureNodeCa, type NodeCa } from "../lib/node-ca.js";
import { logger } from "../lib/logger.js";
import { callNode, type NodeTls } from "./node-client.js";

const ACTIVE = ["ready", "ready_degraded", "idle"] as const;

export async function sweepIdleWorkspaces(
  db: Db,
  opts: {
    now?: Date;
    idleTtlMs: number;
    stopTtlMs: number;
    tls: NodeTls | null;
  },
) {
  const now = opts.now ?? new Date();
  const rows = await db
    .select({
      id: workspaces.id,
      status: workspaces.status,
      lastActiveAt: workspaces.lastActiveAt,
      createdAt: workspaces.createdAt,
      mode: runtimeInstances.mode,
      nodeAddress: nodes.internalAddress,
    })
    .from(workspaces)
    .leftJoin(runtimeInstances, eq(workspaces.instanceId, runtimeInstances.id))
    .leftJoin(nodes, eq(runtimeInstances.nodeId, nodes.id))
    .where(inArray(workspaces.status, [...ACTIVE]));

  for (const row of rows) {
    const at = row.lastActiveAt ?? row.createdAt;
    const age = now.getTime() - at.getTime();
    if (age > opts.stopTtlMs) {
      if (row.mode === "managed") {
        if (!opts.tls || !row.nodeAddress?.startsWith("https://")) {
          logger.warn({ workspaceId: row.id }, "skip managed stop; node address is not ready");
          continue;
        }
        try {
          await callNode(row.nodeAddress, `/workspaces/${row.id}/stop`, opts.tls, { method: "POST", body: {} });
        } catch (err) {
          logger.warn({ err, workspaceId: row.id }, "managed stop failed");
          continue;
        }
      }
      await db
        .update(workspaces)
        .set({ status: "stopped", statusReason: "stop_ttl", updatedAt: now })
        .where(eq(workspaces.id, row.id));
      continue;
    }
    if (age > opts.idleTtlMs && row.status !== "idle") {
      await db
        .update(workspaces)
        .set({ status: "idle", statusReason: "idle_ttl", updatedAt: now })
        .where(eq(workspaces.id, row.id));
    }
  }
}

export async function markStaleNodes(db: Db, now = new Date(), maxAgeMs = 60_000) {
  const rows = await db.select().from(nodes).where(eq(nodes.status, "active"));
  for (const row of rows) {
    if (!row.lastHeartbeatAt) continue;
    if (now.getTime() - row.lastHeartbeatAt.getTime() <= maxAgeMs) continue;
    await db
      .update(nodes)
      .set({ status: "offline", updatedAt: now })
      .where(and(eq(nodes.id, row.id), eq(nodes.status, "active")));
  }
}

export async function tlsForSweep(nodeCaDir: string): Promise<NodeTls | null> {
  try {
    const ca: NodeCa = await ensureNodeCa(nodeCaDir);
    return { cert: ca.hubClientCert, key: ca.hubClientKey, ca: ca.caPem };
  } catch (err) {
    logger.warn({ err }, "node CA unavailable for idle sweep");
    return null;
  }
}
