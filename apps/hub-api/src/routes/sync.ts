import { OpenAPIHono } from "@hono/zod-openapi";
import { SyncTaskResultReqSchema } from "@agenthub/domain";
import type { AppEnv } from "../context.js";
import { unauthenticated } from "../errors.js";
import { readSyncToken, syncPublicKey } from "../lib/sync-crypto.js";
import {
  completeSyncTask,
  listSyncTasks,
  readSyncPayload,
} from "../services/apply-engine.js";

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

function instanceFromToken(header: string | undefined, secret: string) {
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const parsed = token ? readSyncToken(token, secret) : null;
  if (!parsed) throw unauthenticated("Sync token required");
  return parsed.instanceId;
}

export function syncRoutes() {
  const app = new OpenAPIHono<AppEnv>();

  app.get("/pubkey", (c) => {
    return c.json({ publicKey: syncPublicKey(c.get("env").SYNC_ED25519_PUBLIC_KEY) });
  });

  app.get("/tasks", async (c) => {
    const instanceId = instanceFromToken(c.req.header("authorization"), c.get("env").SYNC_TOKEN_SECRET);
    const wait = Math.min(30, Math.max(0, Number(c.req.query("wait") ?? 0)));
    return c.json(await listSyncTasks(c.get("db"), instanceId, applyEnv(c.get("env")), wait));
  });

  app.get("/payloads/:jobId", async (c) => {
    const instanceId = instanceFromToken(c.req.header("authorization"), c.get("env").SYNC_TOKEN_SECRET);
    const exp = Number(c.req.query("exp") ?? 0);
    const sig = c.req.query("sig") ?? "";
    return c.json(
      await readSyncPayload(
        c.get("db"),
        c.req.param("jobId"),
        instanceId,
        applyEnv(c.get("env")),
        exp,
        sig,
      ),
    );
  });

  app.post("/tasks/:id/result", async (c) => {
    const instanceId = instanceFromToken(c.req.header("authorization"), c.get("env").SYNC_TOKEN_SECRET);
    const body = SyncTaskResultReqSchema.parse(await c.req.json());
    return c.json(
      await completeSyncTask(c.get("db"), c.req.param("id"), instanceId, body),
    );
  });

  return app;
}
