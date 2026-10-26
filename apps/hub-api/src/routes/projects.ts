import { OpenAPIHono } from "@hono/zod-openapi";
import {
  AddProjectMemberReqSchema,
  CreateProjectReqSchema,
  PatchProjectMemberReqSchema,
  PatchProjectReqSchema,
} from "@agenthub/domain";
import type { AppEnv } from "../context.js";
import { requireAuth } from "../middleware/auth.js";
import {
  addProjectMember,
  archiveProject,
  assertCanCreateProject,
  createProject,
  getProject,
  listProjectMembers,
  listProjects,
  patchProject,
  patchProjectMember,
  removeProjectMember,
} from "../services/projects.js";

export function projectRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/tenants/:t/projects", async (c) => {
    const t = c.req.param("t");
    const archived = c.req.query("archived") === "true";
    const p = c.get("principal")!;
    return c.json(
      await listProjects(c.get("db"), t, p.userId, p.isPlatformAdmin, { archived }),
    );
  });

  app.post("/tenants/:t/projects", async (c) => {
    const t = c.req.param("t");
    const body = CreateProjectReqSchema.parse(await c.req.json());
    const p = c.get("principal")!;
    await assertCanCreateProject(c.get("db"), t, p.userId, p.isPlatformAdmin);
    return c.json(await createProject(c.get("db"), t, p.userId, body), 201);
  });

  app.get("/projects/:p", async (c) => {
    const principal = c.get("principal")!;
    return c.json(
      await getProject(
        c.get("db"),
        c.req.param("p"),
        principal.userId,
        principal.isPlatformAdmin,
      ),
    );
  });

  app.patch("/projects/:p", async (c) => {
    const body = PatchProjectReqSchema.parse(await c.req.json());
    const principal = c.get("principal")!;
    return c.json(
      await patchProject(
        c.get("db"),
        c.req.param("p"),
        principal.userId,
        principal.isPlatformAdmin,
        body,
      ),
    );
  });

  app.post("/projects/:p/archive", async (c) => {
    const principal = c.get("principal")!;
    return c.json(
      await archiveProject(
        c.get("db"),
        c.req.param("p"),
        principal.userId,
        principal.isPlatformAdmin,
        true,
      ),
    );
  });

  app.post("/projects/:p/unarchive", async (c) => {
    const principal = c.get("principal")!;
    return c.json(
      await archiveProject(
        c.get("db"),
        c.req.param("p"),
        principal.userId,
        principal.isPlatformAdmin,
        false,
      ),
    );
  });

  app.get("/projects/:p/members", async (c) => {
    const principal = c.get("principal")!;
    await getProject(
      c.get("db"),
      c.req.param("p"),
      principal.userId,
      principal.isPlatformAdmin,
    );
    return c.json(await listProjectMembers(c.get("db"), c.req.param("p")));
  });

  app.post("/projects/:p/members", async (c) => {
    const body = AddProjectMemberReqSchema.parse(await c.req.json());
    const principal = c.get("principal")!;
    return c.json(
      await addProjectMember(
        c.get("db"),
        c.req.param("p"),
        principal.userId,
        principal.isPlatformAdmin,
        body,
      ),
      201,
    );
  });

  app.patch("/projects/:p/members/:userId", async (c) => {
    const body = PatchProjectMemberReqSchema.parse(await c.req.json());
    const principal = c.get("principal")!;
    return c.json(
      await patchProjectMember(
        c.get("db"),
        c.req.param("p"),
        c.req.param("userId"),
        principal.userId,
        principal.isPlatformAdmin,
        body.role,
      ),
    );
  });

  app.delete("/projects/:p/members/:userId", async (c) => {
    const principal = c.get("principal")!;
    await removeProjectMember(
      c.get("db"),
      c.req.param("p"),
      c.req.param("userId"),
      principal.userId,
      principal.isPlatformAdmin,
    );
    return c.body(null, 204);
  });

  return app;
}
