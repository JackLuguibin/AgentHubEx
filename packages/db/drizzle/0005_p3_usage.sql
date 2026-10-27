CREATE TABLE IF NOT EXISTS "usage_records" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "session_id" uuid,
  "credential_source" text NOT NULL,
  "credential_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cache_read_tokens" bigint DEFAULT 0 NOT NULL,
  "cost_micros" bigint,
  "source" text NOT NULL,
  "at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id", "at"),
  CONSTRAINT "ck_usage_records_credential_source" CHECK ("credential_source" IN ('user','project')),
  CONSTRAINT "ck_usage_records_source" CHECK ("source" IN ('runtime_event','llm_proxy'))
) PARTITION BY RANGE ("at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_usage_tenant_project_at" ON "usage_records" ("tenant_id", "project_id", "at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_usage_user_at" ON "usage_records" ("user_id", "at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2026_10" PARTITION OF "usage_records" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2026_11" PARTITION OF "usage_records" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2026_12" PARTITION OF "usage_records" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2027_01" PARTITION OF "usage_records" FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2027_02" PARTITION OF "usage_records" FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2027_03" PARTITION OF "usage_records" FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2027_04" PARTITION OF "usage_records" FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2027_05" PARTITION OF "usage_records" FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2027_06" PARTITION OF "usage_records" FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2027_07" PARTITION OF "usage_records" FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2027_08" PARTITION OF "usage_records" FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2027_09" PARTITION OF "usage_records" FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2027_10" PARTITION OF "usage_records" FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2027_11" PARTITION OF "usage_records" FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_2027_12" PARTITION OF "usage_records" FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records_default" PARTITION OF "usage_records" DEFAULT;
