import { OpenAPIHono } from "@hono/zod-openapi";
import {
  UpsertCredentialReqSchema,
  UpsertProjectCredentialReqSchema,
} from "@agenthub/domain";
import type { AppEnv } from "../context.js";
import { requireAuth } from "../middleware/auth.js";
import {
  createProjectCredential,
  createUserCredential,
  deleteProjectCredential,
  deleteUserCredential,
  listCredentialOptions,
  listProjectCredentials,
  listUserCredentials,
  testProjectCredential,
  testUserCredential,
  updateProjectCredential,
  updateUserCredential,
} from "../services/credentials.js";

/** Mounted at /v1/me */
export function meCredentialRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/credentials", async (c) => {
    const p = c.get("principal")!;
    return c.json(await listUserCredentials(c.get("db"), p.userId));
  });

  app.post("/credentials", async (c) => {
    const p = c.get("principal")!;
    const body = UpsertCredentialReqSchema.parse(await c.req.json());
    const created = await createUserCredential(
      c.get("db"),
      p.userId,
      c.get("env").PLATFORM_DEK,
      body,
    );
    return c.json(created, 201);
  });

  app.patch("/credentials/:id", async (c) => {
    const p = c.get("principal")!;
    const body = UpsertCredentialReqSchema.partial().parse(await c.req.json());
    return c.json(
      await updateUserCredential(
        c.get("db"),
        p.userId,
        c.req.param("id"),
        c.get("env").PLATFORM_DEK,
        body,
      ),
    );
  });

  app.delete("/credentials/:id", async (c) => {
    const p = c.get("principal")!;
    await deleteUserCredential(c.get("db"), p.userId, c.req.param("id"));
    return c.body(null, 204);
  });

  app.post("/credentials/:id/test", async (c) => {
    const p = c.get("principal")!;
    return c.json(
      await testUserCredential(c.get("db"), p.userId, c.req.param("id"), c.get("env").PLATFORM_DEK),
    );
  });

  return app;
}

/** Mounted at /v1 */
export function credentialRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/projects/:p/credentials/options", async (c) => {
    const principal = c.get("principal")!;
    return c.json(
      await listCredentialOptions(
        c.get("db"),
        c.req.param("p"),
        principal.userId,
        principal.isPlatformAdmin,
      ),
    );
  });

  app.get("/projects/:p/credentials", async (c) => {
    const principal = c.get("principal")!;
    return c.json(
      await listProjectCredentials(
        c.get("db"),
        c.req.param("p"),
        principal.userId,
        principal.isPlatformAdmin,
      ),
    );
  });

  app.post("/projects/:p/credentials", async (c) => {
    const principal = c.get("principal")!;
    const body = UpsertProjectCredentialReqSchema.parse(await c.req.json());
    const created = await createProjectCredential(
      c.get("db"),
      c.req.param("p"),
      principal.userId,
      principal.isPlatformAdmin,
      c.get("env").PLATFORM_DEK,
      body,
    );
    return c.json(created, 201);
  });

  app.patch("/projects/:p/credentials/:id", async (c) => {
    const principal = c.get("principal")!;
    const body = UpsertProjectCredentialReqSchema.partial().parse(await c.req.json());
    return c.json(
      await updateProjectCredential(
        c.get("db"),
        c.req.param("p"),
        c.req.param("id"),
        principal.userId,
        principal.isPlatformAdmin,
        c.get("env").PLATFORM_DEK,
        body,
      ),
    );
  });

  app.delete("/projects/:p/credentials/:id", async (c) => {
    const principal = c.get("principal")!;
    await deleteProjectCredential(
      c.get("db"),
      c.req.param("p"),
      c.req.param("id"),
      principal.userId,
      principal.isPlatformAdmin,
    );
    return c.body(null, 204);
  });

  app.post("/projects/:p/credentials/:id/test", async (c) => {
    const principal = c.get("principal")!;
    return c.json(
      await testProjectCredential(
        c.get("db"),
        c.req.param("p"),
        c.req.param("id"),
        principal.userId,
        principal.isPlatformAdmin,
        c.get("env").PLATFORM_DEK,
      ),
    );
  });

  return app;
}
