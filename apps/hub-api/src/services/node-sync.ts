import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { nodes } from "@agenthub/db";
import { ensureNodeCa } from "../lib/node-ca.js";
import { callNode, type NodeTls } from "./node-client.js";

export type NodeChannel = { address: string; tls: NodeTls };

/**
 * Hub → node-agent channel. Returns null until the Hub CA exists and the node
 * advertised an https address, so local apply tests keep writing to disk.
 */
export async function managedNodeChannel(
  db: Db,
  instance: { mode: string; nodeId: string | null } | null,
  nodeCaDir?: string,
): Promise<NodeChannel | null> {
  if (!instance || instance.mode !== "managed" || !instance.nodeId || !nodeCaDir) return null;
  try {
    await readFile(path.join(nodeCaDir, "ca.pem"), "utf8");
  } catch {
    return null;
  }
  const [node] = await db.select().from(nodes).where(eq(nodes.id, instance.nodeId)).limit(1);
  if (!node?.internalAddress.startsWith("https://")) return null;
  const ca = await ensureNodeCa(nodeCaDir);
  return {
    address: node.internalAddress,
    tls: { cert: ca.hubClientCert, key: ca.hubClientKey, ca: ca.caPem },
  };
}

export async function applyFilesOnNode(
  channel: NodeChannel,
  workspaceId: string,
  body: { manifest?: unknown; files: { path: string; contentBase64: string }[] },
) {
  return callNode(channel.address, `/workspaces/${workspaceId}/files/apply`, channel.tls, {
    method: "POST",
    body,
  });
}

export async function syncCommonOnNode(
  channel: NodeChannel,
  workspaceId: string,
  body: { path: string; contentBase64?: string; url?: string },
) {
  return callNode(channel.address, `/workspaces/${workspaceId}/common/sync`, channel.tls, {
    method: "POST",
    body,
  });
}
