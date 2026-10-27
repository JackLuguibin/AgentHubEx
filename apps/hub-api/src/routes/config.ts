import { OpenAPIHono } from "@hono/zod-openapi";
import {
  ApplyConfigReqSchema,
  CreateBundleReqSchema,
  ImportSkillReqSchema,
  ManifestSchema,
  PublishBundleReqSchema,
  PutAssignmentsReqSchema,
  RollbackBundleReqSchema,
} from "@agenthub/domain";
import type { AppEnv } from "../context.js";
import { AppError } from "../errors.js";
import { withIdempotency } from "../lib/idempotency.js";
import { issueSyncToken, syncPublicKey } from "../lib/sync-crypto.js";
import { unzipStored } from "../lib/zip.js";
import { requireAuth } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { applyProjectConfig, listApplyJobs } from "../services/apply-engine.js";
import { scheduleBundleAutoSync } from "../services/auto-sync.js";
import {
  createProjectBundle,
  createTenantBundle,
  diffRevision,
  getBundle,
  getLock,
  importSkill,
  listProjectBundles,
  listRevisions,
  listTenantBundles,
  publishBundle,
  putAssignments,
  putBlob,
  putLock,
  resolveEffectiveConfig,
  rollbackBundle,
  updateDraft,
  validateBundle,
} from "../services/config-bundles.js";
import { eq } from "drizzle-orm";
import { runtimeInstances } from "@agenthub/db";
import { forbidden, notFound } from "../errors.js";
import { requireTenantAdmin } from "../services/tenants.js";

function actor(c: { get: (key: "principal") => AppEnv["Variables"]["principal"] }) {
  const principal = c.get("principal")!;
  return { userId: principal.userId, isPlatformAdmin: principal.isPlatformAdmin };
}

function applyEnv(env: AppEnv["Variables"]["env"]) {
  return {
    applyRoot: env.APPLY_ROOT,
    blobRoot: env.BLOB_ROOT,
    platformDek: env.PLATFORM_DEK,
    runtimeMock: env.RUNTIME_MOCK,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    syncTokenSecret: env.SYNC_TOKEN_SECRET,
    syncPrivateKey: env.SYNC_ED25519_PRIVATE_KEY,
  };
}

function idempotencyKey(c: { req: { header: (name: string) => string | undefined } }) {
  const key = c.req.header("idempotency-key");
  if (!key || key.length < 8 || key.length > 200) {
    throw new AppError(400, "VALIDATION_FAILED", "Idempotency-Key required");
  }
  return key;
}

export function configRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/tenants/:t/bundles", async (c) => {
    return c.json(await listTenantBundles(c.get("db"), c.req.param("t"), actor(c)));
  });

  app.post("/tenants/:t/bundles", async (c) => {
    const body = CreateBundleReqSchema.parse(await c.req.json());
    return c.json(await createTenantBundle(c.get("db"), c.req.param("t"), actor(c), body.name), 201);
  });

  app.get("/projects/:p/bundles", async (c) => {
    return c.json(await listProjectBundles(c.get("db"), c.req.param("p"), actor(c)));
  });

  app.post("/projects/:p/bundles", async (c) => {
    const body = CreateBundleReqSchema.parse(await c.req.json());
    return c.json(
      await createProjectBundle(c.get("db"), c.req.param("p"), actor(c), body.name),
      201,
    );
  });

  app.get("/bundles/:b", async (c) => {
    return c.json(await getBundle(c.get("db"), c.req.param("b"), actor(c)));
  });

  app.get("/bundles/:b/draft", async (c) => {
    return c.json(await getBundle(c.get("db"), c.req.param("b"), actor(c)));
  });

  app.put("/bundles/:b/draft", async (c) => {
    const body = ManifestSchema.parse(await c.req.json());
    return c.json(
      await updateDraft(c.get("db"), c.req.param("b"), actor(c), c.req.header("if-match"), body),
    );
  });

  app.post("/bundles/:b/blobs", async (c) => {
    const type = c.req.header("content-type") ?? "";
    let bytes: Buffer;
    if (type.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new AppError(400, "VALIDATION_FAILED", "file is required");
      }
      bytes = Buffer.from(await file.arrayBuffer());
    } else {
      bytes = Buffer.from(await c.req.arrayBuffer());
    }
    return c.json(
      await putBlob(c.get("db"), c.req.param("b"), actor(c), bytes, c.get("env").BLOB_ROOT),
      201,
    );
  });

  app.post("/bundles/:b/skills/import", async (c) => {
    const type = c.req.header("content-type") ?? "";
    let name = "";
    let files: { path: string; bytes: Buffer }[] = [];
    if (type.includes("application/json")) {
      const body = ImportSkillReqSchema.parse(await c.req.json());
      name = body.name;
      files = body.files.map((file) => ({ path: file.path, bytes: Buffer.from(file.content, "utf8") }));
    } else {
      const form = await c.req.formData();
      const file = form.get("file");
      name = String(form.get("name") ?? "");
      if (!(file instanceof File) || !/^[a-z0-9-]{1,48}$/.test(name)) {
        throw new AppError(400, "VALIDATION_FAILED", "zip file and skill name are required");
      }
      const entries = unzipStored(Buffer.from(await file.arrayBuffer()));
      const prefix = commonPrefix(entries.map((entry) => entry.path));
      files = entries.map((entry) => ({
        path: entry.path.slice(prefix.length).replace(/^\/+/, ""),
        bytes: entry.data,
      }));
    }
    const result = await importSkill(c.get("db"), c.req.param("b"), actor(c), c.get("env").BLOB_ROOT, {
      name,
      files,
    });
    return c.json(result.skill, 201);
  });

  app.post("/bundles/:b/validate", async (c) => {
    return c.json(await validateBundle(c.get("db"), c.req.param("b"), actor(c)));
  });

  app.post("/bundles/:b/publish", async (c) => {
    const body = PublishBundleReqSchema.parse(await c.req.json().catch(() => ({})));
    const key = idempotencyKey(c);
    const result = await withIdempotency(
      c.get("redis"),
      `idem:publish:${c.req.param("b")}:${key}`,
      async () => {
        const revision = await publishBundle(c.get("db"), c.req.param("b"), actor(c), body.changelog);
        try {
          await scheduleBundleAutoSync(c.get("db"), c.get("redis"), c.req.param("b"), actor(c).userId);
        } catch (err) {
          logger.warn({ err, bundleId: c.req.param("b") }, "bundle auto sync was not queued");
          recordAudit({
            action: "apply.autosync",
            actorId: actor(c).userId,
            tenantId: c.get("principal")?.tenantId,
            targetType: "bundle",
            targetId: c.req.param("b"),
            meta: { kind: "config", trigger: "publish", status: "failed", error: "自动同步没有进入队列" },
          });
        }
        return { status: 201, body: revision };
      },
    );
    return c.json(result.body, result.status as 201);
  });

  app.get("/bundles/:b/revisions", async (c) => {
    return c.json(await listRevisions(c.get("db"), c.req.param("b"), actor(c)));
  });

  app.get("/bundles/:b/revisions/:r/diff", async (c) => {
    return c.json(
      await diffRevision(
        c.get("db"),
        c.req.param("b"),
        c.req.param("r"),
        actor(c),
        c.req.query("against"),
      ),
    );
  });

  app.post("/bundles/:b/rollback", async (c) => {
    const body = RollbackBundleReqSchema.parse(await c.req.json());
    const revision = await rollbackBundle(c.get("db"), c.req.param("b"), actor(c), body.revisionId);
    const bundle = await getBundle(c.get("db"), c.req.param("b"), actor(c));
    if (bundle.scope === "project" && bundle.scopeId) {
      await applyProjectConfig(c.get("db"), bundle.scopeId, actor(c), applyEnv(c.get("env")), {
        trigger: "rollback",
      });
    }
    return c.json(revision);
  });

  app.put("/projects/:p/config/assignments", async (c) => {
    const body = PutAssignmentsReqSchema.parse(await c.req.json());
    return c.json(await putAssignments(c.get("db"), c.req.param("p"), actor(c), body.items));
  });

  app.get("/projects/:p/config/lock", async (c) => {
    return c.json(await getLock(c.get("db"), c.req.param("p"), actor(c)));
  });

  app.put("/projects/:p/config/lock", async (c) => {
    return c.json(await putLock(c.get("db"), c.req.param("p"), actor(c), await c.req.json()));
  });

  app.get("/projects/:p/config/effective", async (c) => {
    const effective = await resolveEffectiveConfig(
      c.get("db"),
      c.req.param("p"),
      actor(c),
      c.req.query("userId"),
    );
    return c.json({ hash: effective.hash, manifest: effective.manifest, sources: effective.sources });
  });

  app.post("/projects/:p/config/apply", async (c) => {
    const body = ApplyConfigReqSchema.parse(await c.req.json().catch(() => ({})));
    const key = idempotencyKey(c);
    const projectId = c.req.param("p");
    const principal = c.get("principal")!;
    const result = await withIdempotency(c.get("redis"), `idem:apply:${projectId}:${key}`, async () => {
      const applied = await applyProjectConfig(c.get("db"), projectId, actor(c), applyEnv(c.get("env")), {
        workspaceIds: body.workspaceIds,
        trigger: "manual",
      });
      recordAudit({
        action: "apply.run",
        actorId: principal.userId,
        tenantId: principal.tenantId,
        projectId,
        targetType: "project",
        targetId: projectId,
        meta: { kind: "config", jobCount: applied.jobs.length },
      });
      return { status: 200, body: applied };
    });
    return c.json(result.body, result.status as 200);
  });

  app.get("/projects/:p/apply-jobs", async (c) => {
    return c.json(
      await listApplyJobs(c.get("db"), c.req.param("p"), actor(c), {
        workspaceId: c.req.query("workspaceId"),
        status: c.req.query("status"),
      }),
    );
  });

  app.post("/instances/:id/sync-token", async (c) => {
    const principal = c.get("principal")!;
    const [instance] = await c
      .get("db")
      .select()
      .from(runtimeInstances)
      .where(eq(runtimeInstances.id, c.req.param("id")))
      .limit(1);
    if (!instance) throw notFound("Instance not found");
    if (!instance.tenantId) throw forbidden();
    await requireTenantAdmin(
      c.get("db"),
      instance.tenantId,
      principal.userId,
      principal.isPlatformAdmin,
    );
    const issued = issueSyncToken(instance.id, c.get("env").SYNC_TOKEN_SECRET);
    return c.json({
      token: issued.token,
      expiresAt: issued.expiresAt,
      publicKey: syncPublicKey(c.get("env").SYNC_ED25519_PUBLIC_KEY),
    });
  });

  return app;
}

function commonPrefix(paths: string[]) {
  if (paths.length === 0) return "";
  const first = paths[0]!.split("/");
  if (first.length < 2) return "";
  const top = `${first[0]}/`;
  if (paths.every((path) => path.startsWith(top))) return top;
  return "";
}
