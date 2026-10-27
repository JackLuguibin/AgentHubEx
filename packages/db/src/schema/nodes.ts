import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";

/** Worker machines. See architecture 15.7 and 05. */
export const nodes = pgTable(
  "nodes",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    labels: jsonb("labels").notNull().default({}),
    status: text("status").notNull().default("active"),
    capacity: jsonb("capacity").notNull(),
    used: jsonb("used").notNull().default({}),
    agentVersion: text("agent_version"),
    certFingerprint: text("cert_fingerprint").notNull(),
    certNotAfter: timestamp("cert_not_after", { withTimezone: true }),
    internalAddress: text("internal_address").notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_nodes_name").on(t.name),
    index("ix_nodes_status").on(t.status),
    check(
      "ck_nodes_status",
      sql`${t.status} IN ('active','draining','offline','disabled')`,
    ),
  ],
);

export const nodeBootstrapTokens = pgTable(
  "node_bootstrap_tokens",
  {
    id: uuid("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    labels: jsonb("labels").notNull().default({}),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    nodeId: uuid("node_id").references(() => nodes.id),
  },
  (t) => [
    unique("uq_node_bootstrap_tokens_hash").on(t.tokenHash),
    index("ix_node_bootstrap_tokens_node").on(t.nodeId),
  ],
);
