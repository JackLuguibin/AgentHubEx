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
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./identity.js";
import { users } from "./identity.js";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const userCredentials = pgTable(
  "user_credentials",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    label: text("label").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    last4: text("last4"),
    status: text("status").notNull().default("active"),
    currentVersion: integer("current_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_user_credentials_user").on(t.userId, t.provider),
    check("ck_user_credentials_status", sql`${t.status} IN ('active','disabled','expired')`),
  ],
);

export const projectCredentials = pgTable(
  "project_credentials",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    provider: text("provider").notNull(),
    label: text("label").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    last4: text("last4"),
    allowedRoles: text("allowed_roles").array().notNull().default(sql`ARRAY['owner','developer']::text[]`),
    isDefault: boolean("is_default").notNull().default(false),
    status: text("status").notNull().default("active"),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("ck_project_credentials_status", sql`${t.status} IN ('active','disabled','expired')`),
    foreignKey({
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: "fk_project_credentials_project",
    }).onDelete("cascade"),
    uniqueIndex("uq_project_credentials_default")
      .on(t.projectId)
      .where(sql`${t.isDefault} = true`),
  ],
);

export const credentialVersions = pgTable(
  "credential_versions",
  {
    credentialKind: text("credential_kind").notNull(),
    credentialId: uuid("credential_id").notNull(),
    version: integer("version").notNull(),
    secretCiphertext: bytea("secret_ciphertext").notNull(),
    keyVersion: integer("key_version").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.credentialKind, t.credentialId, t.version] }),
    check("ck_credential_versions_kind", sql`${t.credentialKind} IN ('user','project','git')`),
  ],
);
