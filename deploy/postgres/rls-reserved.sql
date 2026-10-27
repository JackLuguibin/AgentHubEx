-- RLS reservation (architecture 15.14). NOT APPLIED.
--
-- Evaluation for P4: do not enable these policies in the current migration set.
-- hub-api already filters by tenant in the query layer. Turning RLS on changes
-- the database contract (SET LOCAL app.tenant_id, a BYPASSRLS role for jobs)
-- and needs a reviewed migration. This file is the reserved statement only.

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_tenant ON projects
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
-- Apply the same pattern to other tenant-owned tables when the migration is approved.
-- Migrations and background jobs must use a BYPASSRLS role.
