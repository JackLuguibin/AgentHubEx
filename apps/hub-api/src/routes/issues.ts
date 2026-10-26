import { OpenAPIHono } from "@hono/zod-openapi";
import { CreateIssueReqSchema, UpdateIssueReqSchema } from "@agenthub/domain";
import type { AppEnv } from "../context.js";
import { requireAuth } from "../middleware/auth.js";
import {
  createIssue,
  deleteIssue,
  getIssue,
  listIssues,
  updateIssue,
} from "../services/issues.js";

export function issueRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/projects/:p/issues", async (c) => {
    const principal = c.get("principal")!;
    return c.json(
      await listIssues(
        c.get("db"),
        c.req.param("p"),
        principal.userId,
        principal.isPlatformAdmin,
      ),
    );
  });

  app.post("/projects/:p/issues", async (c) => {
    const principal = c.get("principal")!;
    const body = CreateIssueReqSchema.parse(await c.req.json());
    const created = await createIssue(
      c.get("db"),
      c.req.param("p"),
      principal.userId,
      principal.isPlatformAdmin,
      body,
    );
    return c.json(created, 201);
  });

  app.get("/issues/:idOrKey", async (c) => {
    const principal = c.get("principal")!;
    return c.json(
      await getIssue(
        c.get("db"),
        c.req.param("idOrKey"),
        principal.userId,
        principal.isPlatformAdmin,
      ),
    );
  });

  app.patch("/issues/:idOrKey", async (c) => {
    const principal = c.get("principal")!;
    const body = UpdateIssueReqSchema.parse(await c.req.json());
    return c.json(
      await updateIssue(
        c.get("db"),
        c.req.param("idOrKey"),
        principal.userId,
        principal.isPlatformAdmin,
        body,
      ),
    );
  });

  app.delete("/issues/:idOrKey", async (c) => {
    const principal = c.get("principal")!;
    await deleteIssue(
      c.get("db"),
      c.req.param("idOrKey"),
      principal.userId,
      principal.isPlatformAdmin,
    );
    return c.body(null, 204);
  });

  return app;
}
