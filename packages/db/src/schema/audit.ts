import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const inet = customType<{ data: string }>({
  dataType() {
    return "inet";
  },
});

/** Parent of the monthly partitions created in 0006_p1_audit.sql. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").notNull(),
    tenantId: uuid("tenant_id"),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    projectId: uuid("project_id"),
    meta: jsonb("meta").notNull().default({}),
    ip: inet("ip"),
    requestId: text("request_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.at] }),
    index("ix_audit_tenant_at").on(t.tenantId, t.at),
    index("ix_audit_target").on(t.targetType, t.targetId),
    check(
      "ck_audit_logs_actor_type",
      sql`${t.actorType} IN ('user','api_key','node','sync','system')`,
    ),
  ],
);
