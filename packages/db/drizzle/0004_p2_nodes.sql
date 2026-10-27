CREATE TABLE IF NOT EXISTS "nodes" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "capacity" jsonb NOT NULL,
  "used" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "agent_version" text,
  "cert_fingerprint" text NOT NULL,
  "cert_not_after" timestamptz,
  "internal_address" text NOT NULL,
  "last_heartbeat_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uq_nodes_name" UNIQUE("name"),
  CONSTRAINT "ck_nodes_status" CHECK ("status" IN ('active','draining','offline','disabled'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_nodes_status" ON "nodes" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_nodes_labels" ON "nodes" USING gin ("labels");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "node_bootstrap_tokens" (
  "id" uuid PRIMARY KEY,
  "token_hash" text NOT NULL,
  "labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "node_id" uuid,
  CONSTRAINT "uq_node_bootstrap_tokens_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "node_bootstrap_tokens"
  ADD CONSTRAINT "node_bootstrap_tokens_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "node_bootstrap_tokens"
  ADD CONSTRAINT "node_bootstrap_tokens_node_id_nodes_id_fk"
  FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_node_bootstrap_tokens_node" ON "node_bootstrap_tokens" ("node_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "runtime_instances"
    ADD CONSTRAINT "runtime_instances_node_id_nodes_id_fk"
    FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_workspaces_idle" ON "workspaces" ("status", "last_active_at");
