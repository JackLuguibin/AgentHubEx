import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** citext via extension; values compared case-insensitively in PG */
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    quota: jsonb("quota").notNull().default({}),
    settings: jsonb("settings").notNull().default({}),
    dekCiphertext: bytea("dek_ciphertext").notNull(),
    dekKeyVersion: integer("dek_key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_tenants_slug").on(t.slug),
    check("ck_tenants_status", sql`${t.status} IN ('active','suspended')`),
    check("ck_tenants_slug", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,38}$'`),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: citext("email").notNull(),
    displayName: text("display_name").notNull(),
    handle: text("handle").notNull(),
    passwordHash: text("password_hash"),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    status: text("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_users_email").on(t.email),
    unique("uq_users_handle").on(t.handle),
    check("ck_users_status", sql`${t.status} IN ('active','disabled')`),
  ],
);

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    index("ix_tenant_memberships_user").on(t.userId),
    check("ck_tenant_memberships_role", sql`${t.role} IN ('owner','admin','member')`),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    credentialPolicy: text("credential_policy").notNull().default("user_or_project"),
    commonSyncPolicy: text("common_sync_policy").notNull().default("on_workspace_start"),
    commonQuotaBytes: bigint("common_quota_bytes", { mode: "number" }).notNull().default(5_368_709_120),
    commonUsedBytes: bigint("common_used_bytes", { mode: "number" }).notNull().default(0),
    configLock: jsonb("config_lock").notNull().default({}),
    settings: jsonb("settings").notNull().default({}),
    issueSeq: integer("issue_seq").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_projects_tenant_key").on(t.tenantId, t.key),
    unique("uq_projects_tenant_id").on(t.tenantId, t.id),
    check("ck_projects_key", sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
    check(
      "ck_projects_credential_policy",
      sql`${t.credentialPolicy} IN ('user_or_project','project_only','user_only')`,
    ),
    check(
      "ck_projects_common_sync_policy",
      sql`${t.commonSyncPolicy} IN ('on_workspace_start','on_common_publish')`,
    ),
  ],
);

export const projectMemberships = pgTable(
  "project_memberships",
  {
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("ix_project_memberships_user").on(t.tenantId, t.userId),
    check("ck_project_memberships_role", sql`${t.role} IN ('owner','developer','viewer')`),
    foreignKey({
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: "fk_project_memberships_project",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.userId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: "fk_project_memberships_tenant_member",
    }).onDelete("cascade"),
  ],
);
