import { OpenAPIHono } from "@hono/zod-openapi";
import {
  AddTenantMemberReqSchema,
  CreateTenantReqSchema,
  PatchTenantMemberReqSchema,
  PatchTenantReqSchema,
} from "@agenthub/domain";
import type { AppEnv } from "../context.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.js";
import { forbidden } from "../errors.js";
import {
  addTenantMember,
  createTenant,
  getTenant,
  listTenantMembers,
  patchTenant,
  patchTenantMember,
  removeTenantMember,
  requireTenantAdmin,
  requireTenantMember,
  setTenantStatus,
} from "../services/tenants.js";

export function tenantRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.post("/admin/tenants", async (c) => {
    if (!c.get("principal")?.isPlatformAdmin) throw forbidden("Platform admin required");
    const body = CreateTenantReqSchema.parse(await c.req.json());
    const tenant = await createTenant(c.get("db"), c.get("env").PLATFORM_DEK, body);
    return c.json(tenant, 201);
  });

  app.get("/tenants/:t", async (c) => {
    const t = c.req.param("t");
    const p = c.get("principal")!;
    await requireTenantMember(c.get("db"), t, p.userId, p.isPlatformAdmin);
    return c.json(await getTenant(c.get("db"), t));
  });

  app.patch("/tenants/:t", async (c) => {
    const t = c.req.param("t");
    const body = PatchTenantReqSchema.parse(await c.req.json());
    const p = c.get("principal")!;
    await requireTenantAdmin(c.get("db"), t, p.userId, p.isPlatformAdmin);
    return c.json(await patchTenant(c.get("db"), t, body));
  });

  app.post("/admin/tenants/:t/suspend", requirePlatformAdmin, async (c) => {
    return c.json(await setTenantStatus(c.get("db"), c.req.param("t"), "suspended"));
  });

  app.post("/admin/tenants/:t/unsuspend", requirePlatformAdmin, async (c) => {
    return c.json(await setTenantStatus(c.get("db"), c.req.param("t"), "active"));
  });

  app.get("/tenants/:t/members", async (c) => {
    const t = c.req.param("t");
    const p = c.get("principal")!;
    await requireTenantMember(c.get("db"), t, p.userId, p.isPlatformAdmin);
    return c.json(await listTenantMembers(c.get("db"), t));
  });

  app.post("/tenants/:t/members", async (c) => {
    const t = c.req.param("t");
    const body = AddTenantMemberReqSchema.parse(await c.req.json());
    const p = c.get("principal")!;
    await requireTenantAdmin(c.get("db"), t, p.userId, p.isPlatformAdmin);
    return c.json(await addTenantMember(c.get("db"), t, body), 201);
  });

  app.patch("/tenants/:t/members/:userId", async (c) => {
    const t = c.req.param("t");
    const userId = c.req.param("userId");
    const body = PatchTenantMemberReqSchema.parse(await c.req.json());
    const p = c.get("principal")!;
    await requireTenantAdmin(c.get("db"), t, p.userId, p.isPlatformAdmin);
    return c.json(await patchTenantMember(c.get("db"), t, userId, body.role));
  });

  app.delete("/tenants/:t/members/:userId", async (c) => {
    const t = c.req.param("t");
    const userId = c.req.param("userId");
    const p = c.get("principal")!;
    await requireTenantAdmin(c.get("db"), t, p.userId, p.isPlatformAdmin);
    await removeTenantMember(c.get("db"), t, userId);
    return c.body(null, 204);
  });

  return app;
}
