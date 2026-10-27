import { OpenAPIHono } from "@hono/zod-openapi";
import {
  PatchInstanceReqSchema,
  PutProjectBindingsReqSchema,
  RegisterInstanceReqSchema,
  TestInstanceReqSchema,
} from "@agenthub/domain";
import type { AppEnv } from "../context.js";
import { requireAuth } from "../middleware/auth.js";
import {
  deleteInstance,
  getInstance,
  listInstances,
  listProjectBindings,
  patchInstance,
  probeInstance,
  putProjectBindings,
  registerInstance,
  testInstanceConnection,
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

  app.post("/tenants/:t/instances/test", async (c) => {
    const p = c.get("principal")!;
    const body = TestInstanceReqSchema.parse(await c.req.json());
    return c.json(
      await testInstanceConnection(
        c.get("db"),
        c.req.param("t"),
        p.userId,
        p.isPlatformAdmin,
        c.get("env").PLATFORM_DEK,
        body,
      ),
    );
  });

  app.post("/tenants/:t/instances", async (c) => {
    const p = c.get("principal")!;
    const body = RegisterInstanceReqSchema.parse(await c.req.json());
    const env = c.get("env");
    const created = await registerInstance(
      c.get("db"),
      c.req.param("t"),
      p.userId,
      p.isPlatformAdmin,
      env.PLATFORM_DEK,
      env.DEPLOY_PROFILE,
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

  app.patch("/instances/:id", async (c) => {
    const p = c.get("principal")!;
    const body = PatchInstanceReqSchema.parse(await c.req.json());
    const env = c.get("env");
    return c.json(
      await patchInstance(
        c.get("db"),
        c.req.param("id"),
        p.userId,
        p.isPlatformAdmin,
        env.PLATFORM_DEK,
        env.DEPLOY_PROFILE,
        body,
      ),
    );
  });

  app.post("/instances/:id/probe", async (c) => {
    const p = c.get("principal")!;
    return c.json(
      await probeInstance(
        c.get("db"),
        c.req.param("id"),
        p.userId,
        p.isPlatformAdmin,
        c.get("env").PLATFORM_DEK,
      ),
    );
  });

  app.delete("/instances/:id", async (c) => {
    const p = c.get("principal")!;
    await deleteInstance(c.get("db"), c.req.param("id"), p.userId, p.isPlatformAdmin);
    return c.body(null, 204);
  });

  app.get("/projects/:p/bindings", async (c) => {
    const p = c.get("principal")!;
    return c.json(
      await listProjectBindings(
        c.get("db"),
        c.req.param("p"),
        p.userId,
        p.isPlatformAdmin,
      ),
    );
  });

  app.put("/projects/:p/bindings", async (c) => {
    const p = c.get("principal")!;
    const body = PutProjectBindingsReqSchema.parse(await c.req.json());
    return c.json(
      await putProjectBindings(
        c.get("db"),
        c.req.param("p"),
        p.userId,
        p.isPlatformAdmin,
        body,
      ),
    );
  });

  return app;
}
