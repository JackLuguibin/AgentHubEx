import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { CapacityExceeded, WorkspaceNotFound, commonPathFor, volumePathFor, type Capacity, type DockerControl } from "./docker.js";
import { unpackTar } from "./tar.js";

export type NodeAppDeps = {
  docker: DockerControl;
  capacity: Capacity;
  workspaceRoot: string;
  commonRoot: string;
  bindIp: string;
  agentVersion: string;
  fetchImpl?: typeof fetch;
};

type WorkspaceRecord = {
  workspaceId: string;
  tenantId: string;
  projectId: string;
  userId: string;
  volumePath: string;
  commonPath: string;
  resources: { cpu: number; memMb: number; diskGb: number };
};

const CreateBody = z.object({
  workspaceId: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  runtimeType: z.enum(["opencode", "claude"]),
  image: z.string().min(1),
  resources: z.object({
    cpu: z.number().positive(),
    memMb: z.number().int().positive(),
    diskGb: z.number().int().positive(),
  }),
  bootToken: z.string().min(8),
});

const FileBody = z.object({
  manifest: z.unknown().optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        contentBase64: z.string(),
      }),
    )
    .max(200),
});

const SyncBody = z
  .object({
    path: z.string().min(1),
    url: z.string().url().optional(),
    contentBase64: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.url) || Boolean(value.contentBase64), {
    message: "url or content required",
  });

function fail(c: { json: (b: unknown, s: 400 | 401 | 404 | 409 | 413 | 415 | 500 | 502) => Response }, status: 400 | 401 | 404 | 409 | 413 | 415 | 500 | 502, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

function safeChild(root: string, rel: string): string {
  if (!rel || path.isAbsolute(rel) || rel.includes("\0") || rel.split(/[/\\]/).includes("..")) {
    throw new Error("INVALID_PATH");
  }
  const resolved = path.resolve(root, rel);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error("INVALID_PATH");
  return resolved;
}

export function createNodeApp(deps: NodeAppDeps) {
  const records = new Map<string, WorkspaceRecord>();
  let draining = false;
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof CapacityExceeded) return fail(c, 409, "CAPACITY_EXCEEDED", err.message);
    if (err instanceof WorkspaceNotFound) return fail(c, 404, "WORKSPACE_NOT_FOUND", err.message);
    if (err instanceof Error && err.message === "INVALID_PATH") {
      return fail(c, 400, "INVALID_PATH", "path escapes the workspace volume");
    }
    const message = err instanceof Error ? err.message : "docker error";
    return fail(c, 502, "DOCKER_ERROR", message);
  });

  app.get("/health", (c) => c.json({ ok: true, agentVersion: deps.agentVersion, draining }));

  app.get("/capacity", async (c) => {
    const used = await deps.docker.usage();
    return c.json({ capacity: deps.capacity, used });
  });

  app.post("/workspaces", async (c) => {
    if (draining) return fail(c, 409, "CAPACITY_EXCEEDED", "node is draining");
    const parsed = CreateBody.safeParse(await c.req.json());
    if (!parsed.success) return fail(c, 400, "VALIDATION_FAILED", "invalid workspace spec");
    const body = parsed.data;
    await deps.docker.ensureNetwork();
    const volumePath = volumePathFor(
      deps.workspaceRoot,
      body.tenantId,
      body.projectId,
      body.userId,
      body.workspaceId,
    );
    const commonPath = commonPathFor(deps.commonRoot, body.tenantId, body.projectId);
    const created = await deps.docker.createWorkspace({
      workspaceId: body.workspaceId,
      tenantId: body.tenantId,
      projectId: body.projectId,
      userId: body.userId,
      image: body.image,
      resources: body.resources,
      bootToken: body.bootToken,
      volumePath,
      commonPath,
      bindIp: deps.bindIp,
    });
    records.set(body.workspaceId, {
      workspaceId: body.workspaceId,
      tenantId: body.tenantId,
      projectId: body.projectId,
      userId: body.userId,
      volumePath,
      commonPath,
      resources: body.resources,
    });
    return c.json(
      {
        endpoint: created.endpoint,
        authSecret: body.bootToken,
        volumePath,
        containerId: created.containerId,
      },
      201,
    );
  });

  app.post("/workspaces/:id/start", async (c) => {
    await deps.docker.start(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/workspaces/:id/stop", async (c) => {
    await deps.docker.stop(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.delete("/workspaces/:id", async (c) => {
    const purge = c.req.query("purgeVolume") === "true";
    const id = c.req.param("id");
    const row = records.get(id);
    await deps.docker.remove(id, false);
    if (purge && row) await rm(row.volumePath, { recursive: true, force: true });
    records.delete(id);
    return c.json({ ok: true });
  });

  app.post("/workspaces/:id/files/apply", async (c) => {
    const row = records.get(c.req.param("id"));
    if (!row) return fail(c, 404, "WORKSPACE_NOT_FOUND", "workspace not found");
    const type = c.req.header("content-type") ?? "";
    let files: { path: string; content: Buffer }[] = [];
    let manifest: unknown;
    if (type.includes("application/json")) {
      const parsed = FileBody.safeParse(await c.req.json());
      if (!parsed.success) return fail(c, 400, "VALIDATION_FAILED", "invalid file tree");
      manifest = parsed.data.manifest;
      files = parsed.data.files.map((file) => ({
        path: file.path,
        content: Buffer.from(file.contentBase64, "base64"),
      }));
    } else if (type.includes("application/x-tar")) {
      const buf = Buffer.from(await c.req.arrayBuffer());
      if (buf.length > 32 * 1024 * 1024) return fail(c, 413, "PAYLOAD_TOO_LARGE", "tar is too large");
      files = unpackTar(buf);
    } else {
      return fail(c, 415, "VALIDATION_FAILED", "send JSON or application/x-tar");
    }
    for (const file of files) {
      if (file.content.length > 1_000_000) return fail(c, 413, "PAYLOAD_TOO_LARGE", file.path);
      const dest = safeChild(row.volumePath, file.path);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, file.content);
    }
    if (manifest !== undefined) {
      const dest = safeChild(row.volumePath, ".agenthub/apply-manifest.json");
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, JSON.stringify(manifest));
    }
    return c.json({ ok: true, files: files.length });
  });

  app.post("/workspaces/:id/common/sync", async (c) => {
    const row = records.get(c.req.param("id"));
    if (!row) return fail(c, 404, "WORKSPACE_NOT_FOUND", "workspace not found");
    const parsed = SyncBody.safeParse(await c.req.json());
    if (!parsed.success) return fail(c, 400, "VALIDATION_FAILED", "invalid sync body");
    if (parsed.data.contentBase64) {
      const buf = Buffer.from(parsed.data.contentBase64, "base64");
      if (buf.length > 20 * 1024 * 1024) return fail(c, 413, "PAYLOAD_TOO_LARGE", "common file is too large");
      const dest = safeChild(row.commonPath, parsed.data.path);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      return c.json({ ok: true, bytes: buf.length });
    }
    const url = new URL(parsed.data.url ?? "");
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fail(c, 400, "VALIDATION_FAILED", "sync url must be http(s)");
    }
    const fetchImpl = deps.fetchImpl ?? fetch;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return fail(c, 502, "DOCKER_ERROR", `sync download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) return fail(c, 413, "PAYLOAD_TOO_LARGE", "common file is too large");
    const dest = safeChild(row.commonPath, parsed.data.path);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    return c.json({ ok: true, bytes: buf.length });
  });

  return {
    app,
    setDraining(next: boolean) {
      draining = next;
    },
    record(id: string) {
      return records.get(id);
    },
  };
}
