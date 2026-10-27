CREATE TABLE IF NOT EXISTS "common_files" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "path" text NOT NULL,
  "is_dir" boolean DEFAULT false NOT NULL,
  "size" bigint DEFAULT 0 NOT NULL,
  "mime" text,
  "checksum" text,
  "current_version" integer DEFAULT 0 NOT NULL,
  "uploaded_by" uuid NOT NULL,
  "deleted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "common_files"
  ADD CONSTRAINT "common_files_uploaded_by_users_id_fk"
  FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "common_files"
  ADD CONSTRAINT "fk_common_files_project"
  FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_common_files_path" ON "common_files" ("project_id","path") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_common_files_trgm" ON "common_files" USING gin ("path" gin_trgm_ops);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "common_file_versions" (
  "file_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "object_key" text NOT NULL,
  "checksum" text NOT NULL,
  "size" bigint NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "common_file_versions_pkey" PRIMARY KEY ("file_id","version")
);
--> statement-breakpoint
ALTER TABLE "common_file_versions"
  ADD CONSTRAINT "common_file_versions_file_id_common_files_id_fk"
  FOREIGN KEY ("file_id") REFERENCES "public"."common_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "common_file_versions"
  ADD CONSTRAINT "common_file_versions_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "common_protected_prefixes" (
  "project_id" uuid NOT NULL,
  "prefix" text NOT NULL,
  CONSTRAINT "common_protected_prefixes_pkey" PRIMARY KEY ("project_id","prefix")
);
--> statement-breakpoint
ALTER TABLE "common_protected_prefixes"
  ADD CONSTRAINT "common_protected_prefixes_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
