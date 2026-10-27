import { logger } from "./logger.js";

/**
 * Structured audit event. The partitioned `audit_logs` table is specified in
 * architecture 15.12 but is not in the current schema, so this phase records
 * the same fields (no secrets) on the process log.
 */
export function recordAudit(entry: {
  action: string;
  actorId: string;
  tenantId?: string | null;
  projectId?: string | null;
  targetType: string;
  targetId?: string | null;
  meta?: Record<string, unknown>;
}) {
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
