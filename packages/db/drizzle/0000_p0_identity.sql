CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS "tenants" (
  "id" uuid PRIMARY KEY,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "quota" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dek_ciphertext" bytea NOT NULL,
  "dek_key_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uq_tenants_slug" UNIQUE("slug"),
  CONSTRAINT "ck_tenants_status" CHECK ("status" IN ('active','suspended')),
  CONSTRAINT "ck_tenants_slug" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{1,38}$')
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY,
  "email" citext NOT NULL,
  "display_name" text NOT NULL,
  "handle" text NOT NULL,
  "password_hash" text,
  "is_platform_admin" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_login_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uq_users_email" UNIQUE("email"),
  CONSTRAINT "uq_users_handle" UNIQUE("handle"),
  CONSTRAINT "ck_users_status" CHECK ("status" IN ('active','disabled'))
);

CREATE TABLE IF NOT EXISTS "tenant_memberships" (
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY("tenant_id","user_id"),
  CONSTRAINT "ck_tenant_memberships_role" CHECK ("role" IN ('owner','admin','member'))
);

ALTER TABLE "tenant_memberships"
  ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tenant_memberships"
  ADD CONSTRAINT "tenant_memberships_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX IF NOT EXISTS "ix_tenant_memberships_user" ON "tenant_memberships" USING btree ("user_id");

CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "credential_policy" text DEFAULT 'user_or_project' NOT NULL,
  "common_sync_policy" text DEFAULT 'on_workspace_start' NOT NULL,
  "common_quota_bytes" bigint DEFAULT 5368709120 NOT NULL,
  "common_used_bytes" bigint DEFAULT 0 NOT NULL,
  "config_lock" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "issue_seq" integer DEFAULT 0 NOT NULL,
  "archived_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uq_projects_tenant_key" UNIQUE("tenant_id","key"),
  CONSTRAINT "uq_projects_tenant_id" UNIQUE("tenant_id","id"),
  CONSTRAINT "ck_projects_key" CHECK ("key" ~ '^[A-Z][A-Z0-9]{1,9}$'),
  CONSTRAINT "ck_projects_credential_policy" CHECK ("credential_policy" IN ('user_or_project','project_only','user_only')),
  CONSTRAINT "ck_projects_common_sync_policy" CHECK ("common_sync_policy" IN ('on_workspace_start','on_common_publish'))
);

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE IF NOT EXISTS "project_memberships" (
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "project_memberships_pkey" PRIMARY KEY("project_id","user_id"),
  CONSTRAINT "ck_project_memberships_role" CHECK ("role" IN ('owner','developer','viewer'))
);

ALTER TABLE "project_memberships"
  ADD CONSTRAINT "project_memberships_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "project_memberships"
  ADD CONSTRAINT "fk_project_memberships_project"
  FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "project_memberships"
  ADD CONSTRAINT "fk_project_memberships_tenant_member"
  FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX IF NOT EXISTS "ix_project_memberships_user" ON "project_memberships" USING btree ("tenant_id","user_id");
