import { Hono } from "hono";
import type { AppEnv } from "../context.js";
import { requireAuth } from "../middleware/auth.js";
import { exportAudit, listAudit } from "../services/audit-log.js";
import { requireTenantMember } from "../services/tenants.js";

function queryOf(c: { req: { query: (name: string) => string | undefined } }) {
  return {
    actor: c.req.query("actor") || undefined,
    action: c.req.query("action") || undefined,
    from: c.req.query("from") || undefined,
    to: c.req.query("to") || undefined,
    projectId: c.req.query("projectId") || undefined,
    cursor: c.req.query("cursor") || undefined,
  };
}

export function auditRoutes() {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/tenants/:t/audit/export", async (c) => {
    const tenantId = c.req.param("t");
    const principal = c.get("principal")!;
    await requireTenantMember(c.get("db"), tenantId, principal.userId, principal.isPlatformAdmin);
    const body = await exportAudit(c.get("db"), tenantId, queryOf(c));
    return c.body(body, 200, { "content-type": "application/x-ndjson; charset=utf-8" });
  });

  app.get("/tenants/:t/audit", async (c) => {
    const tenantId = c.req.param("t");
    const principal = c.get("principal")!;
    await requireTenantMember(c.get("db"), tenantId, principal.userId, principal.isPlatformAdmin);
    return c.json(await listAudit(c.get("db"), tenantId, queryOf(c)));
  });

  return app;
}
