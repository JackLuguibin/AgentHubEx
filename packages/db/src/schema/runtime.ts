import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { projects, tenants } from "./identity.js";
import { nodes } from "./nodes.js";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const runtimeInstances = pgTable(
  "runtime_instances",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    mode: text("mode").notNull(),
    runtimeType: text("runtime_type").notNull(),
    baseUrl: text("base_url").notNull(),
    tlsVerify: boolean("tls_verify").notNull().default(true),
    authUsername: text("auth_username"),
    authSecretCiphertext: bytea("auth_secret_ciphertext"),
    authKeyVersion: integer("auth_key_version"),
    isolation: text("isolation").notNull().default("dedicated"),
    labels: jsonb("labels").notNull().default({}),
    healthStatus: text("health_status").notNull().default("pending"),
    healthFailCount: integer("health_fail_count").notNull().default(0),
    latencyMs: integer("latency_ms"),
    upstreamVersion: text("upstream_version"),
    maxSessions: integer("max_sessions"),
    hasSyncAgent: boolean("has_sync_agent").notNull().default(false),
    assignedProjectIds: uuid("assigned_project_ids").array().notNull().default(sql`'{}'::uuid[]`),
    workdirHint: text("workdir_hint"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_runtime_instances_tenant").on(t.tenantId, t.mode, t.healthStatus),
    check("ck_runtime_instances_mode", sql`${t.mode} IN ('external','managed')`),
    check("ck_runtime_instances_runtime_type", sql`${t.runtimeType} IN ('opencode','claude')`),
    check("ck_runtime_instances_isolation", sql`${t.isolation} IN ('dedicated','shared')`),
    check(
      "ck_runtime_instances_health",
      sql`${t.healthStatus} IN ('pending','healthy','degraded','unhealthy','disabled')`,
    ),
    check(
      "ck_runtime_instances_managed",
      sql`${t.mode} = 'external' OR (${t.nodeId} IS NOT NULL AND ${t.tenantId} IS NOT NULL)`,
    ),
  ],
);

export const projectRuntimeBindings = pgTable(
  "project_runtime_bindings",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    runtimeType: text("runtime_type").notNull(),
    instanceId: uuid("instance_id").references(() => runtimeInstances.id, { onDelete: "cascade" }),
    labelSelector: jsonb("label_selector"),
    priority: integer("priority").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_bindings_project").on(t.projectId, t.priority),
    check("ck_bindings_runtime_type", sql`${t.runtimeType} IN ('opencode','claude')`),
    check(
      "ck_binding_target",
      sql`(${t.instanceId} IS NULL) <> (${t.labelSelector} IS NULL)`,
    ),
    foreignKey({
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: "fk_bindings_project",
    }).onDelete("cascade"),
  ],
);
