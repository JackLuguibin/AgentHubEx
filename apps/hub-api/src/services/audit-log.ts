import { and, desc, eq, gte, lte } from "drizzle-orm";
import { auditLogs, users, type Db } from "@agenthub/db";
import { AppError } from "../errors.js";

export type AuditQuery = {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  projectId?: string;
  cursor?: string;
  limit?: number;
};

export type AuditRow = {
  id: string;
  at: string;
  actorId: string | null;
  actorType: string;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  projectId: string | null;
  meta: Record<string, unknown>;
};

function parseDate(value: string | undefined, label: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, "VALIDATION_FAILED", `${label} is not a valid time`);
  }
  return date;
}

function filters(tenantId: string, query: AuditQuery) {
  const parts = [eq(auditLogs.tenantId, tenantId)];
  if (query.actor) parts.push(eq(auditLogs.actorId, query.actor));
  if (query.action) parts.push(eq(auditLogs.action, query.action));
  if (query.projectId) parts.push(eq(auditLogs.projectId, query.projectId));
  const from = parseDate(query.from, "from");
  const to = parseDate(query.to, "to");
  if (from) parts.push(gte(auditLogs.at, from));
  if (to) parts.push(lte(auditLogs.at, to));
  return and(...parts);
}

async function selectRows(db: Db, tenantId: string, query: AuditQuery, limit: number, offset: number) {
  const rows = await db
    .select({
      id: auditLogs.id,
      at: auditLogs.at,
      actorId: auditLogs.actorId,
      actorType: auditLogs.actorType,
      actorName: users.displayName,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      projectId: auditLogs.projectId,
      meta: auditLogs.meta,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorId, users.id))
    .where(filters(tenantId, query))
    .orderBy(desc(auditLogs.at))
    .limit(limit)
    .offset(offset);
  return rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    actorId: row.actorId,
    actorType: row.actorType,
    actorName: row.actorName,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    projectId: row.projectId,
    meta: (row.meta ?? {}) as Record<string, unknown>,
  }));
}

export async function listAudit(db: Db, tenantId: string, query: AuditQuery) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const offset = Number(query.cursor ?? "0");
  const start = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const items = await selectRows(db, tenantId, query, limit, start);
  return {
    items,
    nextCursor: items.length === limit ? String(start + limit) : null,
  };
}

export async function exportAudit(db: Db, tenantId: string, query: AuditQuery) {
  const items = await selectRows(db, tenantId, query, 2000, 0);
  return items.map((row) => JSON.stringify(row)).join("\n");
}
