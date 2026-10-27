import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../context.js";
import { requireAuth } from "../middleware/auth.js";
import { proxyWorkspaceAgent } from "../services/agent-proxy.js";

export function agentProxyRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.all("/workspaces/:w/agent/*", async (c) => {
    const workspaceId = c.req.param("w");
    const p = c.get("principal")!;
    const env = c.get("env");

    const fullPath = c.req.path; // e.g. /workspaces/{id}/agent/file
    const marker = "/agent/";
    const idx = fullPath.indexOf(marker);
    const remainder = idx >= 0 ? fullPath.slice(idx + marker.length) : "";
    const upstreamPath = `/${remainder}`.replace(/\/+/g, "/");

    const url = new URL(c.req.url);
    const search = url.search;

    return proxyWorkspaceAgent(
      c.get("db"),
      workspaceId,
      p.userId,
      p.isPlatformAdmin,
      env.PLATFORM_DEK,
      {
        method: c.req.method,
        upstreamPath,
        search,
        headers: c.req.raw.headers,
      },
    );
  });

  return app;
}
