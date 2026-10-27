import { sql } from "drizzle-orm";
import {
  bigint,
  check,
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
import { projects, tenants, users } from "./identity.js";
import { runtimeInstances } from "./runtime.js";
import { workspaces } from "./workspaces.js";

export const configBundles = pgTable(
  "config_bundles",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    scopeId: uuid("scope_id"),
    name: text("name").notNull(),
    description: text("description"),
    draft: jsonb("draft").notNull().default({}),
    draftUpdatedBy: uuid("draft_updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_bundles_scope").on(t.scope, t.scopeId),
    check("ck_bundles_scope_name", sql`${t.scope} IN ('platform','tenant','project','user')`),
    check("ck_bundle_scope", sql`(${t.scope} = 'platform') = (${t.scopeId} IS NULL)`),
  ],
);

export const configRevisions = pgTable(
  "config_revisions",
  {
    id: uuid("id").primaryKey(),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => configBundles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    state: text("state").notNull(),
    manifest: jsonb("manifest").notNull(),
    contentHash: text("content_hash").notNull(),
    changelog: text("changelog"),
    publishedBy: uuid("published_by")
      .notNull()
      .references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_revisions_version").on(t.bundleId, t.version),
    check("ck_revisions_state", sql`${t.state} IN ('published','archived')`),
  ],
);

export const configBlobs = pgTable("config_blobs", {
  tenantId: uuid("tenant_id"),
  sha256: text("sha256").primaryKey(),
  size: bigint("size", { mode: "number" }).notNull(),
  objectKey: text("object_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const configAssignments = pgTable(
  "config_assignments",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => configBundles.id, { onDelete: "cascade" }),
    pin: text("pin").notNull().default("latest"),
    ordering: integer("ordering").notNull().default(100),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.bundleId] })],
);

export const applyJobs = pgTable(
  "apply_jobs",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id").references(() => runtimeInstances.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    targetHash: text("target_hash").notNull(),
    trigger: text("trigger").notNull(),
    channel: text("channel"),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    diffSummary: jsonb("diff_summary"),
    error: text("error"),
    requestedBy: uuid("requested_by").references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_apply_jobs_ws").on(t.workspaceId, t.createdAt),
    check("ck_apply_jobs_kind", sql`${t.kind} IN ('config','common','git_seed')`),
    check(
      "ck_apply_jobs_trigger",
      sql`${t.trigger} IN ('workspace_ready','manual','publish','rollback','schedule')`,
    ),
    check("ck_apply_jobs_channel", sql`${t.channel} IS NULL OR ${t.channel} IN ('api','file','both')`),
    check(
      "ck_apply_jobs_status",
      sql`${t.status} IN ('queued','running','succeeded','partial','failed','skipped','cancelled')`,
    ),
  ],
);

export const jobsOutbox = pgTable(
  "jobs_outbox",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    jobType: text("job_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => [
    index("ix_jobs_outbox_poll").on(t.status, t.availableAt),
    check("ck_jobs_outbox_status", sql`${t.status} IN ('pending','published','failed')`),
  ],
);
