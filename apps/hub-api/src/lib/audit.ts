import { auditLogs, type Db } from "@agenthub/db";
import { AppError } from "../errors.js";
import { newId } from "./id.js";
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
let auditDb: Db | null = null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_KEY = /secret|password|token|apikey|api_key|authorization|ciphertext|dek/i;

export function bindAuditDb(db: Db | null) {
  auditDb = db;
}

/** Test hook. Production callers only use recordAudit. */
export function tapAudit(listener: (entry: AuditEntry) => void): () => void {
  taps.push(listener);
  return () => {
    const index = taps.indexOf(listener);
    if (index >= 0) taps.splice(index, 1);
  };
}

function asUuid(value: string | null | undefined): string | null {
  if (!value || !UUID.test(value)) return null;
  return value;
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) continue;
      out[key] = scrub(child);
    }
    return out;
  }
  if (typeof value === "string" && /sk-[A-Za-z0-9_-]{8,}/.test(value)) return "[redacted]";
  return value;
}

async function persistAudit(db: Db, entry: AuditEntry) {
  const meta = (scrub(entry.meta ?? {}) ?? {}) as Record<string, unknown>;
  const targetId = asUuid(entry.targetId);
  if (entry.targetId && !targetId) meta.targetRef = entry.targetId;
  const actorId = asUuid(entry.actorId);
  await db.insert(auditLogs).values({
    id: newId(),
    tenantId: asUuid(entry.tenantId),
    actorType: actorId ? "user" : "system",
    actorId,
    action: entry.action.slice(0, 200),
    targetType: entry.targetType.slice(0, 200),
    targetId,
    projectId: asUuid(entry.projectId),
    meta,
    at: new Date(),
  });
}

/**
 * Structured audit event. Writes the same fields to the process log and to
 * `audit_logs`. `meta` is scrubbed before either sink sees it.
 */
export function recordAudit(entry: AuditEntry) {
  for (const tap of taps) tap(entry);
  const meta = (scrub(entry.meta ?? {}) ?? {}) as Record<string, unknown>;
  logger.info(
    {
      audit: true,
      action: entry.action,
      actorId: entry.actorId,
      tenantId: entry.tenantId ?? null,
      projectId: entry.projectId ?? null,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      meta,
    },
    "audit",
  );
  const db = auditDb;
  if (!db) return;
  void persistAudit(db, entry).catch((err) => {
    logger.error({ err: err instanceof Error ? err.name : "audit" }, "audit write failed");
  });
}

/** Record access.denied when a real row is hidden, then rethrow. */
export function rethrowAccessDenied(err: unknown, entry: Omit<AuditEntry, "action">): never {
  if (err instanceof AppError && (err.status === 404 || err.status === 403)) {
    recordAudit({ action: "access.denied", ...entry });
  }
  throw err;
}
