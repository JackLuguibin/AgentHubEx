import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { projects, users } from "./identity.js";

export const projectIssues = pgTable(
  "project_issues",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    seq: integer("seq").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    priority: text("priority").notNull().default("P2"),
    status: text("status").notNull().default("todo"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    rank: text("rank").notNull(),
    resolutionNote: text("resolution_note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_issues_seq").on(t.projectId, t.seq),
    index("ix_issues_board")
      .on(t.projectId, t.status, t.rank)
      .where(sql`${t.deletedAt} IS NULL`),
    index("ix_issues_assignee")
      .on(t.projectId, t.assigneeUserId)
      .where(sql`${t.deletedAt} IS NULL`),
    check("ck_issues_title_len", sql`length(${t.title}) BETWEEN 1 AND 200`),
    check("ck_issues_priority", sql`${t.priority} IN ('P0','P1','P2','P3')`),
    check(
      "ck_issues_status",
      sql`${t.status} IN ('todo','in_progress','in_review','done','cancelled')`,
    ),
    foreignKey({
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: "fk_issues_project",
    }).onDelete("cascade"),
  ],
);
