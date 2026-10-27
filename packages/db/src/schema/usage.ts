import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Parent of the monthly partitions created in 0005_p3_usage.sql. */
export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    userId: uuid("user_id").notNull(),
    sessionId: uuid("session_id"),
    credentialSource: text("credential_source").notNull(),
    credentialId: uuid("credential_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }),
    source: text("source").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.at] }),
    index("ix_usage_tenant_project_at").on(t.tenantId, t.projectId, t.at),
    index("ix_usage_user_at").on(t.userId, t.at),
    check("ck_usage_records_credential_source", sql`${t.credentialSource} IN ('user','project')`),
    check("ck_usage_records_source", sql`${t.source} IN ('runtime_event','llm_proxy')`),
  ],
);
