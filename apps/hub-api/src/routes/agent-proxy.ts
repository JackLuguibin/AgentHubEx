import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../context.js";
import { AppError } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import { openWorkspacePty, proxyWorkspaceAgent } from "../services/agent-proxy.js";

export function agentProxyRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.post("/workspaces/:w/pty/open", async (c) => {
    const p = c.get("principal")!;
    const env = c.get("env");
    const opened = await openWorkspacePty(
      c.get("db"),
      c.req.param("w"),
      p.userId,
      p.isPlatformAdmin,
      env.PLATFORM_DEK,
    );
    return c.json(opened);
  });

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
    const method = c.req.method.toUpperCase();
    let body: ArrayBuffer | undefined;
    if (method !== "GET" && method !== "HEAD") {
      const declared = Number(c.req.header("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > 1_048_576) {
        throw new AppError(400, "VALIDATION_FAILED", "请求体过大");
      }
      body = await c.req.arrayBuffer();
      if (body.byteLength > 1_048_576) {
        throw new AppError(400, "VALIDATION_FAILED", "请求体过大");
      }
    }

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
        body,
      },
    );
  });

  return app;
}
