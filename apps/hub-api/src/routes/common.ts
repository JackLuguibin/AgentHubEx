import { OpenAPIHono } from "@hono/zod-openapi";
import {
  CreateCommonDirSchema,
  MoveCommonFileSchema,
  PutCommonSettingsSchema,
  RestoreCommonVersionSchema,
} from "@agenthub/domain";
import type { AppEnv } from "../context.js";
import { AppError } from "../errors.js";
import { withIdempotency } from "../lib/idempotency.js";
import { createObjectStore } from "../lib/object-store.js";
import { requireAuth } from "../middleware/auth.js";
import {
  createCommonDir,
  deleteCommonFile,
  getCommonSettings,
  listCommonTree,
  listCommonVersions,
  moveCommonFile,
  putCommonFile,
  putCommonSettings,
  readCommonFile,
  restoreCommonVersion,
  searchCommonFiles,
  syncWorkspaceCommon,
  uploadCommonFiles,
  uploadCommonZip,
} from "../services/common-space.js";

function actor(c: { get: (key: "principal") => AppEnv["Variables"]["principal"] }) {
  const principal = c.get("principal")!;
  return { userId: principal.userId, isPlatformAdmin: principal.isPlatformAdmin };
}

function storeOf(env: AppEnv["Variables"]["env"]) {
  return createObjectStore({
    endpoint: env.S3_ENDPOINT,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    root: env.COMMON_ROOT,
  });
}

function idempotencyKey(c: { req: { header: (name: string) => string | undefined } }) {
  const key = c.req.header("idempotency-key");
  if (!key || key.length < 8 || key.length > 200) {
    throw new AppError(400, "VALIDATION_FAILED", "Idempotency-Key required");
  }
  return key;
}

function requestFilePath(c: { req: { path: string; param: (name: string) => string | undefined } }) {
  const starred = c.req.param("*");
  const raw =
    starred && starred.length > 0
      ? starred
      : (() => {
          const marker = "/common/files/";
          const index = c.req.path.indexOf(marker);
          return index < 0 ? "" : c.req.path.slice(index + marker.length);
        })();
  return splitFilePath(raw);
}

function splitFilePath(raw: string) {
  const decoded = raw
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join("/");
  if (decoded.endsWith("/versions")) {
    return { path: decoded.slice(0, -"/versions".length), action: "versions" as const };
  }
  if (decoded.endsWith("/restore")) {
    return { path: decoded.slice(0, -"/restore".length), action: "restore" as const };
  }
  return { path: decoded, action: "file" as const };
}

export function commonRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/projects/:p/common/tree", async (c) => {
    const depth = Number(c.req.query("depth") ?? 1);
    if (!Number.isInteger(depth) || depth < 1 || depth > 32) {
      throw new AppError(400, "VALIDATION_FAILED", "depth 必须是 1 到 32");
    }
    return c.json(
      await listCommonTree(c.get("db"), c.req.param("p"), actor(c), c.req.query("prefix") ?? "", depth),
    );
  });

  app.get("/projects/:p/common/search", async (c) => {
    return c.json(
      await searchCommonFiles(c.get("db"), c.req.param("p"), actor(c), c.req.query("q") ?? ""),
    );
  });

  app.get("/projects/:p/common/settings", async (c) => {
    return c.json(await getCommonSettings(c.get("db"), c.req.param("p"), actor(c)));
  });

  app.put("/projects/:p/common/settings", async (c) => {
    const body = PutCommonSettingsSchema.parse(await c.req.json());
    return c.json(await putCommonSettings(c.get("db"), c.req.param("p"), actor(c), body));
  });

  app.post("/projects/:p/common/dirs", async (c) => {
    const body = CreateCommonDirSchema.parse(await c.req.json());
    return c.json(await createCommonDir(c.get("db"), c.req.param("p"), actor(c), body.path), 201);
  });

  app.post("/projects/:p/common/upload", async (c) => {
    const key = idempotencyKey(c);
    const form = await c.req.formData();
    const prefix = String(form.get("prefix") ?? "");
    const uploads: { name: string; bytes: Buffer; mime: string | null }[] = [];
    for (const item of form.getAll("files")) {
      if (typeof item === "string") continue;
      uploads.push({
        name: item.name,
        bytes: Buffer.from(await item.arrayBuffer()),
        mime: item.type || null,
      });
    }
    const result = await withIdempotency(c.get("redis"), `common:upload:${c.req.param("p")}:${key}`, async () => {
      const body = await uploadCommonFiles(
        c.get("db"),
        storeOf(c.get("env")),
        c.req.param("p"),
        actor(c),
        prefix,
        uploads,
      );
      return { status: 201, body };
    });
    return c.json(result.body, result.status as 201);
  });

  app.post("/projects/:p/common/upload-zip", async (c) => {
    const key = idempotencyKey(c);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) throw new AppError(400, "VALIDATION_FAILED", "file is required");
    const prefix = String(form.get("prefix") ?? "");
    const zip = Buffer.from(await file.arrayBuffer());
    const result = await withIdempotency(
      c.get("redis"),
      `common:upload-zip:${c.req.param("p")}:${key}`,
      async () => {
        const body = await uploadCommonZip(
          c.get("db"),
          storeOf(c.get("env")),
          c.req.param("p"),
          actor(c),
          prefix,
          zip,
        );
        return { status: 201, body };
      },
    );
    return c.json(result.body, result.status as 201);
  });

  app.post("/workspaces/:w/sync-common", async (c) => {
    const key = idempotencyKey(c);
    const result = await withIdempotency(c.get("redis"), `common:sync:${c.req.param("w")}:${key}`, async () => {
      const body = await syncWorkspaceCommon(
        c.get("db"),
        storeOf(c.get("env")),
        c.req.param("w"),
        actor(c),
        { applyRoot: c.get("env").APPLY_ROOT },
        "manual",
      );
      return { status: 200, body };
    });
    return c.json(result.body, result.status as 200);
  });

  app.get("/projects/:p/common/files/*", async (c) => {
    const { path, action } = requestFilePath(c);
    if (!path) throw new AppError(400, "VALIDATION_FAILED", "path is required");
    if (action === "versions") {
      return c.json(await listCommonVersions(c.get("db"), c.req.param("p"), actor(c), path));
    }
    if (action !== "file") throw new AppError(404, "NOT_FOUND", "Not found");
    const versionRaw = c.req.query("version");
    const version = versionRaw ? Number(versionRaw) : null;
    if (versionRaw && (!Number.isInteger(version) || (version ?? 0) < 1)) {
      throw new AppError(400, "VALIDATION_FAILED", "version 无效");
    }
    const file = await readCommonFile(
      c.get("db"),
      storeOf(c.get("env")),
      c.req.param("p"),
      actor(c),
      path,
      version,
    );
    c.header("etag", `"${file.checksum}"`);
    c.header("content-type", file.mime);
    if (c.req.query("download") === "1") {
      c.header("content-disposition", `attachment; filename="${file.name.replaceAll('"', "")}"`);
    }
    return c.body(new Uint8Array(file.body));
  });

  app.put("/projects/:p/common/files/*", async (c) => {
    const { path, action } = requestFilePath(c);
    if (!path || action !== "file") throw new AppError(400, "VALIDATION_FAILED", "path is required");
    const body = Buffer.from(await c.req.arrayBuffer());
    const entry = await putCommonFile(
      c.get("db"),
      storeOf(c.get("env")),
      c.req.param("p"),
      actor(c),
      path,
      body,
      c.req.header("content-type") ?? null,
      c.req.header("if-match") ?? null,
    );
    return c.json(entry);
  });

  app.patch("/projects/:p/common/files/*", async (c) => {
    const { path, action } = requestFilePath(c);
    if (!path || action !== "file") throw new AppError(400, "VALIDATION_FAILED", "path is required");
    const body = MoveCommonFileSchema.parse(await c.req.json());
    return c.json(await moveCommonFile(c.get("db"), c.req.param("p"), actor(c), path, body.moveTo));
  });

  app.delete("/projects/:p/common/files/*", async (c) => {
    const { path, action } = requestFilePath(c);
    if (!path || action !== "file") throw new AppError(400, "VALIDATION_FAILED", "path is required");
    const recursive = c.req.query("recursive") === "1" || c.req.query("recursive") === "true";
    await deleteCommonFile(c.get("db"), c.req.param("p"), actor(c), path, recursive);
    return c.body(null, 204);
  });

  app.post("/projects/:p/common/files/*", async (c) => {
    const { path, action } = requestFilePath(c);
    if (action !== "restore" || !path) throw new AppError(404, "NOT_FOUND", "Not found");
    const body = RestoreCommonVersionSchema.parse(await c.req.json());
    return c.json(
      await restoreCommonVersion(
        c.get("db"),
        storeOf(c.get("env")),
        c.req.param("p"),
        actor(c),
        path,
        body.version,
      ),
    );
  });

  return app;
}
