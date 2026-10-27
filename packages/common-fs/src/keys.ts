import { createHash } from "node:crypto";
import { CommonFsError } from "./path.js";

function safeId(label: string, value: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new CommonFsError("INVALID_PATH", `${label} 不能包含路径分隔符`);
  }
}

function sha256Hex(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new CommonFsError("INVALID_PATH", "checksum 必须是 sha256");
  }
}

/** Content-addressed object. Same bytes share one key. */
export function objectKey(tenantId: string, projectId: string, sha256: string): string {
  safeId("tenantId", tenantId);
  safeId("projectId", projectId);
  sha256Hex(sha256);
  return `tenants/${tenantId}/projects/${projectId}/objects/${sha256}`;
}

/** Snapshot archive key. Sync reuses the hash; the bytes are the file manifest. */
export function snapshotObjectKey(tenantId: string, projectId: string, snapshotHash: string): string {
  safeId("tenantId", tenantId);
  safeId("projectId", projectId);
  sha256Hex(snapshotHash);
  return `tenants/${tenantId}/projects/${projectId}/common-snapshots/${snapshotHash}.tar.zst`;
}

export function sha256Buffer(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function snapshotHash(entries: { path: string; checksum: string }[]): string {
  const lines = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.path}\t${entry.checksum}`);
  return sha256Buffer(Buffer.from(lines.join("\n")));
}
