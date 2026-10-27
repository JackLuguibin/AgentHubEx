import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { probeAllInstances } from "./services/instances.js";

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

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    logger.info({ port: info.port }, "hub-api listening");
  },
);
