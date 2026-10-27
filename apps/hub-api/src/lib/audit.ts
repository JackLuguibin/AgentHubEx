import { AppError } from "../errors.js";
import { logger } from "./logger.js";

export type AuditEntry = {
  action: string;
  actorId: string;
  tenantId?: string | null;
  projectId?: string | null;
  targetType: string;
  targetId?: string | null;
  meta?: Record<string, unknown>;
};

const taps: Array<(entry: AuditEntry) => void> = [];

/** Test hook. Production callers only use recordAudit. */
export function tapAudit(listener: (entry: AuditEntry) => void): () => void {
  taps.push(listener);
  return () => {
    const index = taps.indexOf(listener);
    if (index >= 0) taps.splice(index, 1);
  };
}

/**
 * Structured audit event. The partitioned `audit_logs` table is specified in
 * architecture 15.12 but is not in the current schema, so this phase records
 * the same fields (no secrets) on the process log.
 */
export function recordAudit(entry: AuditEntry) {
  for (const tap of taps) tap(entry);
  logger.info(
    {
      audit: true,
      action: entry.action,
      actorId: entry.actorId,
      tenantId: entry.tenantId ?? null,
      projectId: entry.projectId ?? null,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      meta: entry.meta ?? {},
    },
    "audit",
  );
}

/** Record access.denied when a real row is hidden, then rethrow. */
export function rethrowAccessDenied(err: unknown, entry: Omit<AuditEntry, "action">): never {
  if (err instanceof AppError && (err.status === 404 || err.status === 403)) {
    recordAudit({ action: "access.denied", ...entry });
  }
  throw err;
}
