import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ensureNodeCa } from "./lib/node-ca.js";
import { startHubNodeMtls } from "./lib/node-mtls.js";
import { logger } from "./lib/logger.js";
import { probeAllInstances } from "./services/instances.js";
import { markStaleNodes, sweepIdleWorkspaces, tlsForSweep } from "./services/idle.js";

const { app, db, env } = createApp();

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
