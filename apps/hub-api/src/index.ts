import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";

const { app, env } = createApp();

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    logger.info({ port: info.port }, "hub-api listening");
  },
);
