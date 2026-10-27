import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ensureNodeCa } from "./lib/node-ca.js";
import { createObjectStore } from "./lib/object-store.js";
import { startHubNodeMtls } from "./lib/node-mtls.js";
import { logger } from "./lib/logger.js";
import { startAutoSync } from "./services/auto-sync.js";
import { probeAllInstances } from "./services/instances.js";
import { markStaleNodes, sweepIdleWorkspaces, tlsForSweep } from "./services/idle.js";

const { app, db, env } = createApp();

startAutoSync({
  db,
  applyEnv: {
    applyRoot: env.APPLY_ROOT,
    blobRoot: env.BLOB_ROOT,
    platformDek: env.PLATFORM_DEK,
    runtimeMock: env.RUNTIME_MOCK,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    syncTokenSecret: env.SYNC_TOKEN_SECRET,
    syncPrivateKey: env.SYNC_ED25519_PRIVATE_KEY,
  },
  store: createObjectStore({
    endpoint: env.S3_ENDPOINT,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    root: env.COMMON_ROOT,
  }),
}).catch((err) => logger.error({ err }, "hub-jobs failed to start"));

const HEALTH_PROBE_INTERVAL_MS = 30_000;
let probing = false;
setInterval(() => {
  if (probing) return;
  probing = true;
  probeAllInstances(db, env.PLATFORM_DEK)
    .catch((err) => logger.warn({ err }, "instance health sweep failed"))
    .finally(() => {
      probing = false;
    });
}, HEALTH_PROBE_INTERVAL_MS).unref();

const IDLE_SWEEP_MS = 60_000;
let sweeping = false;
setInterval(() => {
  if (sweeping) return;
  sweeping = true;
  Promise.all([
    tlsForSweep(env.NODE_CA_DIR).then((tls) =>
      sweepIdleWorkspaces(db, {
        idleTtlMs: env.IDLE_TTL_MS,
        stopTtlMs: env.STOP_TTL_MS,
        tls,
      }),
    ),
    markStaleNodes(db),
  ])
    .catch((err) => logger.warn({ err }, "workspace idle sweep failed"))
    .finally(() => {
      sweeping = false;
    });
}, IDLE_SWEEP_MS).unref();

if (env.NODE_MTLS_PORT > 0) {
  ensureNodeCa(env.NODE_CA_DIR)
    .then((ca) => startHubNodeMtls(app, ca, env.NODE_MTLS_PORT))
    .then((info) => logger.info({ port: info.port }, "hub node mTLS listening"))
    .catch((err) => logger.error({ err }, "node mTLS listener failed"));
}

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    logger.info({ port: info.port }, "hub-api listening");
  },
);
