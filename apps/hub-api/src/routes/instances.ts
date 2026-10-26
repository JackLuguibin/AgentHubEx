import { OpenAPIHono } from "@hono/zod-openapi";
import { RegisterInstanceReqSchema } from "@agenthub/domain";
import type { AppEnv } from "../context.js";
import { requireAuth } from "../middleware/auth.js";
import {
  deleteInstance,
  getInstance,
  listInstances,
  registerInstance,
} from "../services/instances.js";

export function instanceRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/tenants/:t/instances", async (c) => {
    const p = c.get("principal")!;
    return c.json(
      await listInstances(c.get("db"), c.req.param("t"), p.userId, p.isPlatformAdmin),
    );
  });

  app.post("/tenants/:t/instances", async (c) => {
    const p = c.get("principal")!;
    const body = RegisterInstanceReqSchema.parse(await c.req.json());
    const created = await registerInstance(
      c.get("db"),
      c.req.param("t"),
      p.userId,
      p.isPlatformAdmin,
      c.get("env").PLATFORM_DEK,
      body,
    );
    return c.json(created, 201);
  });

  app.get("/instances/:id", async (c) => {
    const p = c.get("principal")!;
    return c.json(
      await getInstance(c.get("db"), c.req.param("id"), p.userId, p.isPlatformAdmin),
    );
  });

  app.delete("/instances/:id", async (c) => {
    const p = c.get("principal")!;
    await deleteInstance(c.get("db"), c.req.param("id"), p.userId, p.isPlatformAdmin);
    return c.body(null, 204);
  });

  return app;
}
