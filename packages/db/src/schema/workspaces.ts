import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { projects, tenants, users } from "./identity.js";
import { runtimeInstances } from "./runtime.js";

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull().default("personal"),
    runtimeType: text("runtime_type").notNull(),
    instanceId: uuid("instance_id").references(() => runtimeInstances.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("provisioning"),
    statusReason: text("status_reason"),
    volumePath: text("volume_path"),
    spec: jsonb("spec").notNull().default({}),
    appliedRevisionHash: text("applied_revision_hash"),
    commonSnapshotHash: text("common_snapshot_hash"),
    commonSyncedAt: timestamp("common_synced_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_workspaces_tenant_id").on(t.tenantId, t.id),
    uniqueIndex("uq_workspaces_personal")
      .on(t.projectId, t.ownerUserId, t.runtimeType)
      .where(sql`${t.kind} = 'personal' AND ${t.status} <> 'deleted'`),
    index("ix_workspaces_instance").on(t.instanceId),
    index("ix_workspaces_idle").on(t.status, t.lastActiveAt),
    check("ck_workspaces_kind", sql`${t.kind} IN ('personal')`),
    check("ck_workspaces_runtime_type", sql`${t.runtimeType} IN ('opencode','claude')`),
    check(
      "ck_workspaces_status",
      sql`${t.status} IN ('provisioning','seeding','applying','ready','ready_degraded','idle','stopped','unavailable','revoked','failed','deleted')`,
    ),
    foreignKey({
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: "fk_workspaces_project",
    }).onDelete("cascade"),
  ],
);

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    runtimeType: text("runtime_type").notNull(),
    runtimeSessionRef: text("runtime_session_ref"),
    credentialSource: text("credential_source").notNull(),
    credentialId: uuid("credential_id").notNull(),
    credentialVersion: integer("credential_version").notNull(),
    issueId: uuid("issue_id"),
    status: text("status").notNull().default("active"),
    statusReason: text("status_reason"),
    model: text("model"),
    agent: text("agent"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    usageInputTokens: bigint("usage_input_tokens", { mode: "number" }).notNull().default(0),
    usageOutputTokens: bigint("usage_output_tokens", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_sessions_owner").on(t.tenantId, t.ownerUserId, t.projectId, t.createdAt),
    index("ix_sessions_workspace").on(t.workspaceId, t.status),
    uniqueIndex("uq_sessions_runtime_ref")
      .on(t.workspaceId, t.runtimeSessionRef)
      .where(sql`${t.runtimeSessionRef} IS NOT NULL`),
    check("ck_sessions_runtime_type", sql`${t.runtimeType} IN ('opencode','claude')`),
    check("ck_sessions_credential_source", sql`${t.credentialSource} IN ('user','project')`),
    check(
      "ck_sessions_status",
      sql`${t.status} IN ('creating','active','busy','idle','aborted','archived','failed')`,
    ),
    foreignKey({
      columns: [t.tenantId, t.workspaceId],
      foreignColumns: [workspaces.tenantId, workspaces.id],
      name: "fk_sessions_workspace",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: "fk_sessions_project",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "fk_sessions_tenant",
    }).onDelete("cascade"),
  ],
);
