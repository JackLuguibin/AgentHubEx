CREATE TABLE IF NOT EXISTS "config_bundles" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid,
  "scope" text NOT NULL,
  "scope_id" uuid,
  "name" text NOT NULL,
  "description" text,
  "draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "draft_updated_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ck_bundles_scope_name" CHECK ("scope" IN ('platform','tenant','project','user')),
  CONSTRAINT "ck_bundle_scope" CHECK (("scope" = 'platform') = ("scope_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "config_bundles"
  ADD CONSTRAINT "config_bundles_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "config_bundles"
  ADD CONSTRAINT "config_bundles_draft_updated_by_users_id_fk"
  FOREIGN KEY ("draft_updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bundles_scope" ON "config_bundles" ("scope","scope_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "config_revisions" (
  "id" uuid PRIMARY KEY,
  "bundle_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "state" text NOT NULL,
  "manifest" jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "changelog" text,
  "published_by" uuid NOT NULL,
  "published_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uq_revisions_version" UNIQUE ("bundle_id","version"),
  CONSTRAINT "ck_revisions_state" CHECK ("state" IN ('published','archived'))
);
--> statement-breakpoint
ALTER TABLE "config_revisions"
  ADD CONSTRAINT "config_revisions_bundle_id_config_bundles_id_fk"
  FOREIGN KEY ("bundle_id") REFERENCES "public"."config_bundles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "config_revisions"
  ADD CONSTRAINT "config_revisions_published_by_users_id_fk"
  FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "config_blobs" (
  "tenant_id" uuid,
  "sha256" text PRIMARY KEY,
  "size" bigint NOT NULL,
  "object_key" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "config_assignments" (
  "project_id" uuid NOT NULL,
  "bundle_id" uuid NOT NULL,
  "pin" text DEFAULT 'latest' NOT NULL,
  "ordering" integer DEFAULT 100 NOT NULL,
  CONSTRAINT "config_assignments_project_id_bundle_id_pk" PRIMARY KEY ("project_id","bundle_id")
);
--> statement-breakpoint
ALTER TABLE "config_assignments"
  ADD CONSTRAINT "config_assignments_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "config_assignments"
  ADD CONSTRAINT "config_assignments_bundle_id_config_bundles_id_fk"
  FOREIGN KEY ("bundle_id") REFERENCES "public"."config_bundles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "apply_jobs" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "instance_id" uuid,
  "kind" text NOT NULL,
  "target_hash" text NOT NULL,
  "trigger" text NOT NULL,
  "channel" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "diff_summary" jsonb,
  "error" text,
  "requested_by" uuid,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ck_apply_jobs_kind" CHECK ("kind" IN ('config','common','git_seed')),
  CONSTRAINT "ck_apply_jobs_trigger" CHECK ("trigger" IN ('workspace_ready','manual','publish','rollback','schedule')),
  CONSTRAINT "ck_apply_jobs_channel" CHECK ("channel" IS NULL OR "channel" IN ('api','file','both')),
  CONSTRAINT "ck_apply_jobs_status" CHECK ("status" IN ('queued','running','succeeded','partial','failed','skipped','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "apply_jobs"
  ADD CONSTRAINT "apply_jobs_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "apply_jobs"
  ADD CONSTRAINT "apply_jobs_instance_id_runtime_instances_id_fk"
  FOREIGN KEY ("instance_id") REFERENCES "public"."runtime_instances"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "apply_jobs"
  ADD CONSTRAINT "apply_jobs_requested_by_users_id_fk"
  FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_apply_jobs_ws" ON "apply_jobs" ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_apply_jobs_status" ON "apply_jobs" ("status") WHERE "status" IN ('queued','running');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "jobs_outbox" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid,
  "job_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "published_at" timestamptz,
  "last_error" text,
  CONSTRAINT "ck_jobs_outbox_status" CHECK ("status" IN ('pending','published','failed'))
);
--> statement-breakpoint
ALTER TABLE "jobs_outbox"
  ADD CONSTRAINT "jobs_outbox_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_jobs_outbox_poll" ON "jobs_outbox" ("status","available_at");
