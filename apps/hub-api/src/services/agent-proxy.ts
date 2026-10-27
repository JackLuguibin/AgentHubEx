import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { runtimeInstances, workspaces } from "@agenthub/db";
import { can } from "@agenthub/auth";
import { AppError, forbidden, notFound } from "../errors.js";
import { classifyAgentUpstreamPath } from "../lib/agent-allowlist.js";
import { instanceRowToCtx } from "./instances.js";
import { resolveProjectAccess } from "./projects.js";

export async function proxyWorkspaceAgent(
  db: Db,
  workspaceId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  request: {
    method: string;
    upstreamPath: string;
    search: string;
    headers: Headers;
  },
): Promise<Response> {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(
      and(eq(workspaces.id, workspaceId), ne(workspaces.status, "deleted")),
    )
    .limit(1);
  if (!ws) throw notFound("Workspace not found");

  const access = await resolveProjectAccess(
    db,
    ws.projectId,
    userId,
    isPlatformAdmin,
  );
  if (!can(access.projectRole, access.tenantRole, "workspace.own", { isPlatformAdmin })) {
    throw forbidden();
  }
  if (ws.ownerUserId !== userId && !isPlatformAdmin) {
    throw notFound("Workspace not found");
  }

  const decision = classifyAgentUpstreamPath(request.method, request.upstreamPath);
  if (decision === "block") {
    throw new AppError(
      403,
      "BLOCKED_UPSTREAM_PATH",
      `Upstream path not allowed via agent proxy: ${request.method} ${request.upstreamPath}`,
    );
  }

  if (!ws.instanceId) {
    throw new AppError(409, "CONFLICT", "Workspace has no runtime instance", {
      details: { code: "WORKSPACE_NOT_READY" },
    });
  }

  const [inst] = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.id, ws.instanceId))
    .limit(1);
  if (!inst) {
    throw new AppError(409, "CONFLICT", "Runtime instance missing", {
      details: { code: "UPSTREAM_UNAVAILABLE" },
    });
  }

  const ctx = instanceRowToCtx(inst, platformDek);
  // RUNTIME_MOCK only supplies a fallback instance; real registered instances are always proxied.
  if (ctx.mock) {
    return mockAgentResponse(request.method, request.upstreamPath, request.search);
  }

  const upstreamUrl = `${inst.baseUrl.replace(/\/$/, "")}${request.upstreamPath}${request.search}`;
  // Client Authorization/Cookie are never forwarded; only instance Basic Auth is injected.
  const headers = new Headers();
  if (ctx.auth) {
    const token = Buffer.from(`${ctx.auth.username}:${ctx.auth.password}`).toString("base64");
    headers.set("authorization", `Basic ${token}`);
  }
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);

  let upstream: Response;
  try {
    // Allowlist only admits GET, so no request body is forwarded.
    upstream = await fetch(upstreamUrl, { method: "GET", headers });
  } catch (err) {
    throw new AppError(
      502,
      "CONFLICT",
      err instanceof Error ? err.message : "Upstream unavailable",
      { details: { code: "UPSTREAM_UNAVAILABLE" } },
    );
  }

  const outHeaders = new Headers();
  const passThrough = ["content-type", "content-length", "cache-control"];
  for (const key of passThrough) {
    const v = upstream.headers.get(key);
    if (v) outHeaders.set(key, v);
  }

  // Never leak upstream baseUrl in JSON bodies for config GETs — best-effort scrub
  if (
    request.method === "GET" &&
    (request.upstreamPath === "/config" || request.upstreamPath.startsWith("/config/"))
  ) {
    const text = await upstream.text();
    const scrubbed = text
      .replaceAll(inst.baseUrl, "[redacted]")
      .replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"[redacted]"')
      .replace(/"secret"\s*:\s*"[^"]*"/gi, '"secret":"[redacted]"');
    outHeaders.set("content-type", upstream.headers.get("content-type") ?? "application/json");
    return new Response(scrubbed, { status: upstream.status, headers: outHeaders });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

function mockAgentResponse(method: string, path: string, search: string): Response {
  const bare = path.split("?")[0] ?? path;
  if (method === "GET" && (bare === "/file" || bare.startsWith("/file/"))) {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const filePath = params.get("path") ?? "/";
    return Response.json({
      path: filePath,
      type: filePath.endsWith("/") || filePath === "/" ? "directory" : "file",
      entries:
        filePath === "/" || filePath.endsWith("/")
          ? [
              { name: "README.md", type: "file" },
              { name: "src", type: "directory" },
            ]
          : undefined,
      content:
        filePath.endsWith(".md") || filePath.endsWith(".ts")
          ? `# mock file\npath=${filePath}\n`
          : undefined,
    });
  }
  if (method === "GET" && (bare === "/find" || bare.startsWith("/find/"))) {
    return Response.json({ matches: [] });
  }
  if (method === "GET" && (bare === "/agent" || bare === "/mcp" || bare === "/config")) {
    return Response.json({ ok: true, mock: true });
  }
  return Response.json({ ok: true, mock: true, path: bare });
}
