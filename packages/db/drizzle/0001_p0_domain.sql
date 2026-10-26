CREATE TABLE IF NOT EXISTS "user_credentials" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "label" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last4" text,
  "status" text DEFAULT 'active' NOT NULL,
  "current_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ck_user_credentials_status" CHECK ("status" IN ('active','disabled','expired'))
);
--> statement-breakpoint
ALTER TABLE "user_credentials"
  ADD CONSTRAINT "user_credentials_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_user_credentials_user" ON "user_credentials" ("user_id","provider");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_credentials" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "label" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last4" text,
  "allowed_roles" text[] DEFAULT ARRAY['owner','developer']::text[] NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "current_version" integer DEFAULT 1 NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ck_project_credentials_status" CHECK ("status" IN ('active','disabled','expired'))
);
--> statement-breakpoint
ALTER TABLE "project_credentials"
  ADD CONSTRAINT "project_credentials_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_credentials"
  ADD CONSTRAINT "fk_project_credentials_project"
  FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_credentials_default" ON "project_credentials" ("project_id") WHERE "is_default" = true;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "credential_versions" (
  "credential_kind" text NOT NULL,
  "credential_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "secret_ciphertext" bytea NOT NULL,
  "key_version" integer NOT NULL,
  "revoked_at" timestamptz,
  "created_by" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "credential_versions_pkey" PRIMARY KEY("credential_kind","credential_id","version"),
  CONSTRAINT "ck_credential_versions_kind" CHECK ("credential_kind" IN ('user','project','git'))
);
--> statement-breakpoint
ALTER TABLE "credential_versions"
  ADD CONSTRAINT "credential_versions_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "runtime_instances" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid,
  "node_id" uuid,
  "name" text NOT NULL,
  "mode" text NOT NULL,
  "runtime_type" text NOT NULL,
  "base_url" text NOT NULL,
  "tls_verify" boolean DEFAULT true NOT NULL,
  "auth_username" text,
  "auth_secret_ciphertext" bytea,
  "auth_key_version" integer,
  "isolation" text DEFAULT 'dedicated' NOT NULL,
  "labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "health_status" text DEFAULT 'pending' NOT NULL,
  "health_fail_count" integer DEFAULT 0 NOT NULL,
  "latency_ms" integer,
  "upstream_version" text,
  "max_sessions" integer,
  "has_sync_agent" boolean DEFAULT false NOT NULL,
  "assigned_project_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "workdir_hint" text,
  "last_checked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ck_runtime_instances_mode" CHECK ("mode" IN ('external','managed')),
  CONSTRAINT "ck_runtime_instances_runtime_type" CHECK ("runtime_type" IN ('opencode','claude')),
  CONSTRAINT "ck_runtime_instances_isolation" CHECK ("isolation" IN ('dedicated','shared')),
  CONSTRAINT "ck_runtime_instances_health" CHECK ("health_status" IN ('pending','healthy','degraded','unhealthy','disabled')),
  CONSTRAINT "ck_runtime_instances_managed" CHECK ("mode" = 'external' OR ("node_id" IS NOT NULL AND "tenant_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "runtime_instances"
  ADD CONSTRAINT "runtime_instances_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_runtime_instances_tenant" ON "runtime_instances" ("tenant_id","mode","health_status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_runtime_bindings" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "runtime_type" text NOT NULL,
  "instance_id" uuid,
  "label_selector" jsonb,
  "priority" integer DEFAULT 100 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ck_bindings_runtime_type" CHECK ("runtime_type" IN ('opencode','claude')),
  CONSTRAINT "ck_binding_target" CHECK (("instance_id" IS NULL) <> ("label_selector" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "project_runtime_bindings"
  ADD CONSTRAINT "project_runtime_bindings_instance_id_runtime_instances_id_fk"
  FOREIGN KEY ("instance_id") REFERENCES "public"."runtime_instances"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_runtime_bindings"
  ADD CONSTRAINT "fk_bindings_project"
  FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bindings_project" ON "project_runtime_bindings" ("project_id","priority");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workspaces" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "kind" text DEFAULT 'personal' NOT NULL,
  "runtime_type" text NOT NULL,
  "instance_id" uuid,
  "status" text DEFAULT 'provisioning' NOT NULL,
  "status_reason" text,
  "volume_path" text,
  "spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "applied_revision_hash" text,
  "common_snapshot_hash" text,
  "common_synced_at" timestamptz,
  "last_active_at" timestamptz,
  "revoked_at" timestamptz,
  "purge_after" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uq_workspaces_tenant_id" UNIQUE("tenant_id","id"),
  CONSTRAINT "ck_workspaces_kind" CHECK ("kind" IN ('personal')),
  CONSTRAINT "ck_workspaces_runtime_type" CHECK ("runtime_type" IN ('opencode','claude')),
  CONSTRAINT "ck_workspaces_status" CHECK ("status" IN ('provisioning','seeding','applying','ready','ready_degraded','idle','stopped','unavailable','revoked','failed','deleted'))
);
--> statement-breakpoint
ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_instance_id_runtime_instances_id_fk"
  FOREIGN KEY ("instance_id") REFERENCES "public"."runtime_instances"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspaces"
  ADD CONSTRAINT "fk_workspaces_project"
  FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_workspaces_personal" ON "workspaces" ("project_id","owner_user_id","runtime_type") WHERE "kind" = 'personal' AND "status" <> 'deleted';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_workspaces_instance" ON "workspaces" ("instance_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_sessions" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "runtime_type" text NOT NULL,
  "runtime_session_ref" text,
  "credential_source" text NOT NULL,
  "credential_id" uuid NOT NULL,
  "credential_version" integer NOT NULL,
  "issue_id" uuid,
  "status" text DEFAULT 'active' NOT NULL,
  "status_reason" text,
  "model" text,
  "agent" text,
  "last_message_at" timestamptz,
  "usage_input_tokens" bigint DEFAULT 0 NOT NULL,
  "usage_output_tokens" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ck_sessions_runtime_type" CHECK ("runtime_type" IN ('opencode','claude')),
  CONSTRAINT "ck_sessions_credential_source" CHECK ("credential_source" IN ('user','project')),
  CONSTRAINT "ck_sessions_status" CHECK ("status" IN ('creating','active','busy','idle','aborted','archived','failed'))
);
--> statement-breakpoint
ALTER TABLE "agent_sessions"
  ADD CONSTRAINT "agent_sessions_owner_user_id_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_sessions"
  ADD CONSTRAINT "fk_sessions_workspace"
  FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_sessions"
  ADD CONSTRAINT "fk_sessions_project"
  FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_sessions"
  ADD CONSTRAINT "fk_sessions_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_sessions_owner" ON "agent_sessions" ("tenant_id","owner_user_id","project_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_sessions_workspace" ON "agent_sessions" ("workspace_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sessions_runtime_ref" ON "agent_sessions" ("workspace_id","runtime_session_ref") WHERE "runtime_session_ref" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_issues" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "seq" integer NOT NULL,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "priority" text DEFAULT 'P2' NOT NULL,
  "status" text DEFAULT 'todo' NOT NULL,
  "assignee_user_id" uuid,
  "labels" text[] DEFAULT '{}'::text[] NOT NULL,
  "rank" text NOT NULL,
  "resolution_note" text,
  "created_by" uuid NOT NULL,
  "closed_at" timestamptz,
  "deleted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uq_issues_seq" UNIQUE("project_id","seq"),
  CONSTRAINT "ck_issues_title_len" CHECK (length("title") BETWEEN 1 AND 200),
  CONSTRAINT "ck_issues_priority" CHECK ("priority" IN ('P0','P1','P2','P3')),
  CONSTRAINT "ck_issues_status" CHECK ("status" IN ('todo','in_progress','in_review','done','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "project_issues"
  ADD CONSTRAINT "project_issues_assignee_user_id_users_id_fk"
  FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_issues"
  ADD CONSTRAINT "project_issues_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_issues"
  ADD CONSTRAINT "fk_issues_project"
  FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_issues_board" ON "project_issues" ("project_id","status","rank") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_issues_assignee" ON "project_issues" ("project_id","assignee_user_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hub_api_keys" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "created_by" uuid NOT NULL,
  "acting_user_id" uuid,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "secret_hash" text NOT NULL,
  "scopes" text[] NOT NULL,
  "expires_at" timestamptz,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uq_hub_api_keys_prefix" UNIQUE("prefix")
);
--> statement-breakpoint
ALTER TABLE "hub_api_keys"
  ADD CONSTRAINT "hub_api_keys_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hub_api_keys"
  ADD CONSTRAINT "hub_api_keys_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hub_api_keys"
  ADD CONSTRAINT "hub_api_keys_acting_user_id_users_id_fk"
  FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
