import { randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { runtimeInstances, tenants, workspaces } from "@agenthub/db";
import { can } from "@agenthub/auth";
import { DEFAULT_CAPABILITIES, capabilitiesForRuntime, type InstanceCtx } from "@agenthub/runtime-contract";
import { AppError, forbidden, notFound } from "../errors.js";
import {
  classifyAgentUpstreamPath,
  personalFileWriteAllowed,
  ptyGateOpen,
} from "../lib/agent-allowlist.js";
import { recordAudit, rethrowAccessDenied } from "../lib/audit.js";
import { instanceRowToCtx } from "./instances.js";
import { adapterFor } from "./runtime-adapter.js";
import { resolveProjectAccess } from "./projects.js";
import { issuePtyTicket, readUpstreamId, readUpstreamTicket, upstreamPtyUrl } from "./pty-bridge.js";

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
    body?: ArrayBuffer;
  },
): Promise<Response> {
  const ws = await loadOwnedWorkspace(db, workspaceId, userId, isPlatformAdmin, "agent");
  const decision = classifyAgentUpstreamPath(request.method, request.upstreamPath);
  if (decision === "block") {
    throw new AppError(
      403,
      "BLOCKED_UPSTREAM_PATH",
      `Upstream path not allowed via agent proxy: ${request.method} ${request.upstreamPath}`,
    );
  }
  if (decision === "file-write") {
    const params = new URLSearchParams(request.search.startsWith("?") ? request.search.slice(1) : request.search);
    const filePath = params.get("path") ?? "";
    if (!personalFileWriteAllowed(filePath)) {
      throw new AppError(403, "PROTECTED_PATH", "只能编辑个人工作区里的文本文件");
    }
    readEditableText(request.body);
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
  if (decision === "pty" && !(await workspacePtyOpen(db, ws.tenantId, ctx, ws.runtimeType))) {
    throw new AppError(501, "NOT_SUPPORTED_BY_RUNTIME", "当前运行实例没有终端能力");
  }
  // RUNTIME_MOCK only supplies a fallback instance; real registered instances are always proxied.
  if (ctx.mock) {
    return mockAgentResponse(request.method, request.upstreamPath, request.search, request.body);
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
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const method = request.method.toUpperCase();

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : request.body,
    });
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

const mockFileText: Record<string, string> = {
  "/README.md": "# 个人工作区\n这是只读预览示例。\n",
  "/src/main.ts": "export const ready = true;\n",
  "/project-common/docs/architecture.md": "# 公共资料\nproject-common 只读。\n",
};

const MOCK_DIRS: Record<string, Array<{ name: string; type: "file" | "directory" }>> = {
  "/": [
    { name: "README.md", type: "file" },
    { name: "src", type: "directory" },
    { name: "project-common", type: "directory" },
  ],
  "/src": [{ name: "main.ts", type: "file" }],
  "/project-common": [{ name: "docs", type: "directory" }],
  "/project-common/docs": [{ name: "architecture.md", type: "file" }],
};

function normalizeMockPath(filePath: string) {
  if (!filePath || filePath === "/") return "/";
  const withSlash = filePath.startsWith("/") ? filePath : `/${filePath}`;
  return withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

function mockAgentResponse(method: string, path: string, search: string, body?: ArrayBuffer): Response {
  const bare = path.split("?")[0] ?? path;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (method.toUpperCase() === "PUT" && bare === "/file/content") {
    const filePath = normalizeMockPath(params.get("path") ?? "");
    const content = readEditableText(body);
    mockFileText[filePath] = content;
    return Response.json({ path: filePath, type: "file", content });
  }
  if (method === "GET" && (bare === "/file" || bare.startsWith("/file/"))) {
    const filePath = normalizeMockPath(params.get("path") ?? "/");
    if (bare === "/file" && MOCK_DIRS[filePath]) {
      return Response.json(MOCK_DIRS[filePath]);
    }
    if (filePath in mockFileText) {
      return Response.json({
        path: filePath,
        type: "file",
        content: mockFileText[filePath],
      });
    }
    return Response.json({ path: filePath, type: "file", content: "" });
  }
  if (method === "GET" && (bare === "/find" || bare.startsWith("/find/"))) {
    const q = (params.get("q") ?? params.get("pattern") ?? "").toLowerCase();
    const matches = Object.keys(mockFileText)
      .filter((item) => !q || item.toLowerCase().includes(q))
      .map((item) => ({ path: item, name: item.split("/").pop(), type: "file" as const }));
    return Response.json({ matches });
  }
  if (method === "POST" && bare === "/pty") {
    return Response.json({ id: `mock_${randomBytes(4).toString("hex")}` });
  }
  if (method === "GET" && (bare === "/agent" || bare === "/mcp" || bare === "/config")) {
    return Response.json({ ok: true, mock: true });
  }
  return Response.json({ ok: true, mock: true, path: bare });
}

const MAX_EDIT_CHARS = 512 * 1024;

function readEditableText(body: ArrayBuffer | undefined) {
  if (!body || body.byteLength === 0) {
    throw new AppError(400, "VALIDATION_FAILED", "缺少文件内容");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new AppError(400, "VALIDATION_FAILED", "文件内容必须是 JSON");
  }
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { content?: unknown }).content !== "string") {
    throw new AppError(400, "VALIDATION_FAILED", "文件内容必须是字符串");
  }
  const content = (parsed as { content: string }).content;
  if (content.includes("\0") || content.length > MAX_EDIT_CHARS) {
    throw new AppError(400, "VALIDATION_FAILED", "只能保存较短的文本文件");
  }
  return content;
}

async function workspacePtyOpen(db: Db, tenantId: string, ctx: InstanceCtx, runtimeType: string) {
  const [tenant] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const capabilities = await adapterFor(runtimeType)
    .capabilities(ctx)
    .catch(() =>
      runtimeType === "claude" ? capabilitiesForRuntime("claude") : DEFAULT_CAPABILITIES,
    );
  return ptyGateOpen(capabilities, tenant?.settings);
}

async function loadOwnedWorkspace(
  db: Db,
  workspaceId: string,
  userId: string,
  isPlatformAdmin: boolean,
  surface: string,
) {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), ne(workspaces.status, "deleted")))
    .limit(1);
  if (!ws) throw notFound("Workspace not found");

  let access;
  try {
    access = await resolveProjectAccess(db, ws.projectId, userId, isPlatformAdmin);
  } catch (err) {
    rethrowAccessDenied(err, {
      actorId: userId,
      tenantId: ws.tenantId,
      projectId: ws.projectId,
      targetType: "workspace",
      targetId: ws.id,
      meta: { reason: "not_member", surface },
    });
  }
  if (!can(access.projectRole, access.tenantRole, "workspace.own", { isPlatformAdmin })) {
    recordAudit({
      action: "access.denied",
      actorId: userId,
      tenantId: ws.tenantId,
      projectId: ws.projectId,
      targetType: "workspace",
      targetId: ws.id,
      meta: { reason: "forbidden", surface },
    });
    throw forbidden();
  }
  if (ws.ownerUserId !== userId && !isPlatformAdmin) {
    recordAudit({
      action: "access.denied",
      actorId: userId,
      tenantId: ws.tenantId,
      projectId: ws.projectId,
      targetType: "workspace",
      targetId: ws.id,
      meta: { reason: "not_owner", surface },
    });
    throw notFound("Workspace not found");
  }
  return ws;
}

async function loadWorkspaceCtx(
  db: Db,
  workspaceId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  surface: string,
) {
  const ws = await loadOwnedWorkspace(db, workspaceId, userId, isPlatformAdmin, surface);
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
  return { ws, inst, ctx: instanceRowToCtx(inst, platformDek) };
}

export async function openWorkspacePty(
  db: Db,
  workspaceId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
) {
  const { ws, inst, ctx } = await loadWorkspaceCtx(
    db,
    workspaceId,
    userId,
    isPlatformAdmin,
    platformDek,
    "pty",
  );
  if (!(await workspacePtyOpen(db, ws.tenantId, ctx, ws.runtimeType))) {
    throw new AppError(501, "NOT_SUPPORTED_BY_RUNTIME", "当前运行实例没有终端能力");
  }
  if (ctx.mock) {
    return issuePtyTicket({
      kind: "mock",
      ptyId: `mock_${randomBytes(4).toString("hex")}`,
      workspaceId: ws.id,
    });
  }

  const headers = new Headers({ "content-type": "application/json" });
  if (ctx.auth) {
    headers.set(
      "authorization",
      `Basic ${Buffer.from(`${ctx.auth.username}:${ctx.auth.password}`).toString("base64")}`,
    );
  }
  const base = inst.baseUrl.replace(/\/$/, "");
  let created: Response;
  try {
    created = await fetch(`${base}/pty`, { method: "POST", headers, body: JSON.stringify({ title: "Workbench" }) });
  } catch {
    throw new AppError(502, "UPSTREAM_UNAVAILABLE", "终端暂时不可用");
  }
  if (!created.ok) throw new AppError(502, "UPSTREAM_UNAVAILABLE", "终端暂时不可用");
  const ptyId = readUpstreamId(await created.json().catch(() => null));
  if (!ptyId) throw new AppError(502, "UPSTREAM_UNAVAILABLE", "终端暂时不可用");

  let upstreamTicket: string | undefined;
  try {
    const tokenRes = await fetch(`${base}/pty/${encodeURIComponent(ptyId)}/connect-token`, {
      method: "POST",
      headers,
    });
    if (tokenRes.ok) upstreamTicket = readUpstreamTicket(await tokenRes.json().catch(() => null)) ?? undefined;
  } catch {
    upstreamTicket = undefined;
  }

  return issuePtyTicket({
    kind: "live",
    ptyId,
    workspaceId: ws.id,
    url: upstreamPtyUrl(base, ptyId, upstreamTicket),
    authorization: headers.get("authorization") ?? undefined,
  });
}
