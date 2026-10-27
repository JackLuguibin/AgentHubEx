import { createHash, randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Db } from "@agenthub/db";
import { nodeBootstrapTokens, nodes, runtimeInstances, workspaces } from "@agenthub/db";
import { AppError } from "../errors.js";
import { recordAudit } from "../lib/audit.js";
import { ensureNodeCa, fingerprintPem } from "../lib/node-ca.js";
import { logger } from "../lib/logger.js";
import { newId } from "../lib/id.js";
import { toIso } from "../lib/time.js";
import { asLabels, asResources, semverLt } from "../lib/schedule.js";

export type NodeResources = {
  cpu: number;
  memMb: number;
  diskGb: number;
  maxWorkspaces: number;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createBootstrapToken(
  db: Db,
  userId: string,
  publicBaseUrl: string,
  input: { labels?: Record<string, string>; ttlMinutes?: number; mtlsPort?: number },
) {
  const ttl = Math.min(24 * 60, Math.max(5, input.ttlMinutes ?? 60));
  const token = randomBytes(32).toString("base64url");
  const id = newId();
  const expiresAt = new Date(Date.now() + ttl * 60_000);
  await db.insert(nodeBootstrapTokens).values({
    id,
    tokenHash: hashToken(token),
    labels: input.labels ?? {},
    createdBy: userId,
    expiresAt,
  });
  const mtls = input.mtlsPort && input.mtlsPort > 0 ? input.mtlsPort : 8443;
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    installCommand: `AGENTHUB_URL=${publicBaseUrl} HUB_MTLS_URL=https://<hub-host>:${mtls} BOOTSTRAP_TOKEN=${token} pnpm --filter @agenthub/node-agent start`,
  };
}

export async function registerNode(
  db: Db,
  nodeCaDir: string,
  input: {
    token: string;
    csr: string;
    capacity: NodeResources;
    labels: Record<string, string>;
    agentVersion: string;
    hostname?: string;
  },
) {
  if (!input.csr.includes("BEGIN CERTIFICATE REQUEST")) {
    throw new AppError(401, "BOOTSTRAP_INVALID", "Bootstrap token is invalid");
  }
  const [token] = await db
    .select()
    .from(nodeBootstrapTokens)
    .where(eq(nodeBootstrapTokens.tokenHash, hashToken(input.token)))
    .limit(1);
  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now()) {
    throw new AppError(401, "BOOTSTRAP_INVALID", "Bootstrap token is invalid");
  }
  const ca = await ensureNodeCa(nodeCaDir);
  const signed = await ca.signCsr(input.csr);
  const id = newId();
  const host = (input.hostname ?? "node").replace(/[^a-zA-Z0-9.-]/g, "").slice(0, 40) || "node";
  const labels = { ...asLabels(token.labels), ...input.labels };
  await db.insert(nodes).values({
    id,
    name: `${host}-${id.slice(0, 8)}`,
    labels,
    status: "active",
    capacity: input.capacity,
    used: { cpu: 0, memMb: 0, diskGb: 0, workspaces: 0 },
    agentVersion: input.agentVersion,
    certFingerprint: fingerprintPem(signed.certPem),
    certNotAfter: signed.notAfter,
    internalAddress: "pending://await-heartbeat",
  });
  await db
    .update(nodeBootstrapTokens)
    .set({ usedAt: new Date(), nodeId: id })
    .where(eq(nodeBootstrapTokens.id, token.id));
  recordAudit({
    action: "node.register",
    actorId: token.createdBy,
    targetType: "node",
    targetId: id,
    meta: { agentVersion: input.agentVersion },
  });
  return {
    nodeId: id,
    cert: signed.certPem,
    caBundle: ca.caPem,
    notAfter: signed.notAfter.toISOString(),
  };
}

type HeartbeatWorkspace = { id: string; state: "running" | "stopped" | "missing"; containerId?: string };

export async function heartbeatNode(
  db: Db,
  redis: Redis,
  fingerprint: string,
  minAgentVersion: string,
  input: {
    used: { cpu: number; memMb: number; diskGb: number; workspaces: number };
    workspaces: HeartbeatWorkspace[];
    agentVersion: string;
    wallTime: string;
    advertiseUrl?: string;
  },
) {
  const [node] = await db.select().from(nodes).where(eq(nodes.certFingerprint, fingerprint)).limit(1);
  if (!node) throw new AppError(401, "CERT_EXPIRED", "Node certificate is not registered");
  const wall = Date.parse(input.wallTime);
  if (Number.isFinite(wall) && Math.abs(Date.now() - wall) > 60_000) {
    logger.warn({ nodeId: node.id, wallTime: input.wallTime }, "node clock skew exceeds 60s");
  }
  const labels = asLabels(node.labels);
  if (semverLt(input.agentVersion, minAgentVersion)) {
    labels.agentHealth = "degraded";
    recordAudit({
      action: "node.version_unsupported",
      actorId: node.id,
      targetType: "node",
      targetId: node.id,
      meta: { agentVersion: input.agentVersion, minAgentVersion },
    });
  } else {
    delete labels.agentHealth;
  }
  let status = node.status;
  if (status === "offline") status = "active";
  const address =
    input.advertiseUrl && input.advertiseUrl.startsWith("https://") ? input.advertiseUrl : node.internalAddress;
  await db
    .update(nodes)
    .set({
      used: input.used,
      agentVersion: input.agentVersion,
      labels,
      status,
      internalAddress: address,
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(nodes.id, node.id));
  await reconcile(db, node.id, input.workspaces);

  const commands: Array<Record<string, unknown>> = [];
  if (node.status === "draining" || status === "draining") commands.push({ type: "drain" });
  if (node.certNotAfter && node.certNotAfter.getTime() - Date.now() < 14 * 24 * 60 * 60 * 1000) {
    commands.push({ type: "renew_cert_hint" });
  }
  try {
    const queued = await redis.lrange(`node:commands:${node.id}`, 0, -1);
    if (queued.length > 0) await redis.del(`node:commands:${node.id}`);
    for (const item of queued) {
      commands.push(JSON.parse(item) as Record<string, unknown>);
    }
  } catch (err) {
    logger.warn({ err, nodeId: node.id }, "node command queue unavailable");
  }
  return { commands, minAgentVersion };
}

async function reconcile(db: Db, nodeId: string, reported: HeartbeatWorkspace[]) {
  const instances = await db.select().from(runtimeInstances).where(eq(runtimeInstances.nodeId, nodeId));
  if (instances.length === 0 && reported.length === 0) return;
  const instanceIds = instances.map((row) => row.id);
  const owned = instanceIds.length
    ? await db.select().from(workspaces).where(inArray(workspaces.instanceId, instanceIds))
    : [];
  const byId = new Map(reported.map((row) => [row.id, row]));
  const known = new Set(owned.map((row) => row.id));
  for (const ws of owned) {
    const report = byId.get(ws.id);
    const live = ["provisioning", "seeding", "applying", "ready", "ready_degraded", "idle"].includes(ws.status);
    if (live && (!report || report.state === "missing")) {
      await db
        .update(workspaces)
        .set({ status: "unavailable", statusReason: "node_missing", updatedAt: new Date() })
        .where(eq(workspaces.id, ws.id));
      recordAudit({
        action: "workspace.missing_on_node",
        actorId: nodeId,
        tenantId: ws.tenantId,
        projectId: ws.projectId,
        targetType: "workspace",
        targetId: ws.id,
      });
    }
    if (ws.status === "stopped" && report?.state === "running") {
      recordAudit({
        action: "node.unknown_container",
        actorId: nodeId,
        tenantId: ws.tenantId,
        projectId: ws.projectId,
        targetType: "workspace",
        targetId: ws.id,
        meta: { containerId: report.containerId ?? null, reason: "still_running" },
      });
    }
  }
  for (const report of reported) {
    if (known.has(report.id) || report.state === "missing") continue;
    recordAudit({
      action: "node.unknown_container",
      actorId: nodeId,
      targetType: "workspace",
      targetId: report.id,
      meta: { containerId: report.containerId ?? null },
    });
  }
}

export async function renewNodeCert(db: Db, nodeCaDir: string, fingerprint: string, csr: string) {
  const [node] = await db.select().from(nodes).where(eq(nodes.certFingerprint, fingerprint)).limit(1);
  if (!node) throw new AppError(401, "CERT_EXPIRED", "Node certificate is not registered");
  if (node.status === "disabled") throw new AppError(403, "FORBIDDEN", "Node is disabled");
  const ca = await ensureNodeCa(nodeCaDir);
  const signed = await ca.signCsr(csr);
  await db
    .update(nodes)
    .set({
      certFingerprint: fingerprintPem(signed.certPem),
      certNotAfter: signed.notAfter,
      updatedAt: new Date(),
    })
    .where(eq(nodes.id, node.id));
  return { cert: signed.certPem, notAfter: signed.notAfter.toISOString() };
}

export async function listNodes(db: Db) {
  const rows = await db.select().from(nodes);
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      labels: asLabels(row.labels),
      capacity: row.capacity,
      used: asResources(row.used),
      agentVersion: row.agentVersion ?? "",
      lastHeartbeatAt: toIso(row.lastHeartbeatAt),
    })),
    nextCursor: null as string | null,
  };
}

export async function patchNode(
  db: Db,
  nodeId: string,
  patch: { status?: "draining" | "active" | "disabled"; labels?: Record<string, string> },
) {
  const [row] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
  if (!row) throw new AppError(404, "NOT_FOUND", "Node not found");
  const labels = patch.labels ? { ...asLabels(row.labels), ...patch.labels } : asLabels(row.labels);
  const [updated] = await db
    .update(nodes)
    .set({
      status: patch.status ?? row.status,
      labels,
      updatedAt: new Date(),
    })
    .where(eq(nodes.id, nodeId))
    .returning();
  return {
    id: updated!.id,
    name: updated!.name,
    status: updated!.status,
    labels: asLabels(updated!.labels),
    capacity: updated!.capacity,
    used: asResources(updated!.used),
    agentVersion: updated!.agentVersion ?? "",
    lastHeartbeatAt: toIso(updated!.lastHeartbeatAt),
  };
}
