import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { projects, users } from "./identity.js";

export const commonFiles = pgTable(
  "common_files",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    path: text("path").notNull(),
    isDir: boolean("is_dir").notNull().default(false),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    mime: text("mime"),
    checksum: text("checksum"),
    currentVersion: integer("current_version").notNull().default(0),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_common_files_path")
      .on(t.projectId, t.path)
      .where(sql`${t.deletedAt} IS NULL`),
    foreignKey({
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: "fk_common_files_project",
    }).onDelete("cascade"),
  ],
);

export const commonFileVersions = pgTable(
  "common_file_versions",
  {
    fileId: uuid("file_id")
      .notNull()
      .references(() => commonFiles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    objectKey: text("object_key").notNull(),
    checksum: text("checksum").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.version] })],
);

export const commonProtectedPrefixes = pgTable(
  "common_protected_prefixes",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    prefix: text("prefix").notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.prefix] })],
);
