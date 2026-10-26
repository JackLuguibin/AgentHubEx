import { OpenAPIHono } from "@hono/zod-openapi";
import {
  CreateInvitationReqSchema,
  PutUserBindingsReqSchema,
} from "@agenthub/domain";
import type { AppEnv } from "../context.js";
import { requireAuth } from "../middleware/auth.js";
import {
  createInvitation,
  getUserBindings,
  listBindingCatalog,
  listDirectoryUsers,
  putUserBindings,
} from "../services/memberships.js";

export function membershipRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/directory/users", async (c) => {
    const p = c.get("principal")!;
    const tenantId = c.req.query("tenantId") || undefined;
    const q = c.req.query("q") || undefined;
    return c.json(
      await listDirectoryUsers(c.get("db"), p.userId, p.isPlatformAdmin, {
        tenantId,
        q,
      }),
    );
  });

  app.get("/bindings/catalog", async (c) => {
    const p = c.get("principal")!;
    return c.json(
      await listBindingCatalog(c.get("db"), p.userId, p.isPlatformAdmin),
    );
  });

  app.get("/users/:userId/bindings", async (c) => {
    const p = c.get("principal")!;
    return c.json(
      await getUserBindings(
        c.get("db"),
        c.req.param("userId"),
        p.userId,
        p.isPlatformAdmin,
      ),
    );
  });

  app.put("/users/:userId/bindings", async (c) => {
    const p = c.get("principal")!;
    const body = PutUserBindingsReqSchema.parse(await c.req.json());
    return c.json(
      await putUserBindings(
        c.get("db"),
        c.req.param("userId"),
        p.userId,
        p.isPlatformAdmin,
        body,
      ),
    );
  });

  app.post("/tenants/:t/invitations", async (c) => {
    const p = c.get("principal")!;
    const body = CreateInvitationReqSchema.parse(await c.req.json());
    return c.json(
      await createInvitation(
        c.get("db"),
        c.req.param("t"),
        p.userId,
        p.isPlatformAdmin,
        body,
      ),
      201,
    );
  });

  return app;
}
