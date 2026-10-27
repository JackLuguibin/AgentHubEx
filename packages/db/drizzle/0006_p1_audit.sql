CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid,
  "actor_type" text NOT NULL,
  "actor_id" uuid,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" uuid,
  "project_id" uuid,
  "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ip" inet,
  "request_id" text,
  "at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id", "at"),
  CONSTRAINT "ck_audit_logs_actor_type" CHECK ("actor_type" IN ('user','api_key','node','sync','system'))
) PARTITION BY RANGE ("at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_audit_tenant_at" ON "audit_logs" ("tenant_id", "at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_audit_target" ON "audit_logs" ("target_type", "target_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs_2026_10" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs_2026_11" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs_2026_12" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs_default" PARTITION OF "audit_logs" DEFAULT;
