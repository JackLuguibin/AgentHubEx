import { OpenAPIHono } from "@hono/zod-openapi";
import { createDb, type Db } from "@agenthub/db";
import { Redis } from "ioredis";
import { cors } from "hono/cors";
import type { AppEnv } from "./context.js";
import { env } from "./env.js";
import { bindHubJobsRedis } from "./lib/hub-jobs.js";
import { errorHandler } from "./middleware/error-handler.js";
import { optionalAuth } from "./middleware/auth.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { authRoutes, meRoutes } from "./routes/auth.js";
import { credentialRoutes } from "./routes/credentials.js";
import { commonRoutes } from "./routes/common.js";
import { configRoutes } from "./routes/config.js";
import { instanceRoutes } from "./routes/instances.js";
import { agentProxyRoutes } from "./routes/agent-proxy.js";
import { issueRoutes } from "./routes/issues.js";
import { membershipRoutes } from "./routes/memberships.js";
import { projectRoutes } from "./routes/projects.js";
import { llmProxyRoutes } from "./routes/llm-proxy.js";
import { sessionRoutes } from "./routes/sessions.js";
import { usageRoutes } from "./routes/usage.js";
import { nodeRoutes } from "./routes/nodes.js";
import { syncRoutes } from "./routes/sync.js";
import { tenantRoutes } from "./routes/tenants.js";

export type CreateAppOptions = {
  db?: Db;
  redis?: Redis;
  envOverrides?: Partial<typeof env>;
};

export function createApp(options: CreateAppOptions = {}) {
  const appEnv = { ...env, ...options.envOverrides };
  bindHubJobsRedis(appEnv.REDIS_URL);
  const db = options.db ?? createDb(appEnv.DATABASE_URL);
  const redis =
    options.redis ?? new Redis(appEnv.REDIS_URL, { maxRetriesPerRequest: 1 });

  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: {
              code: "VALIDATION_FAILED",
              message: "Validation failed",
              requestId: c.get("requestId") ?? "unknown",
              fieldErrors: result.error.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
              })),
            },
          },
          400,
        );
      }
    },
  });
  app.onError(errorHandler);

  app.use("*", requestIdMiddleware);
  app.use(
    "*",
    cors({
      origin: appEnv.CORS_ORIGIN,
      credentials: true,
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "If-Match",
        "Last-Event-ID",
        "X-Request-Id",
      ],
      exposeHeaders: ["X-Request-Id"],
    }),
  );
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("redis", redis);
    c.set("env", appEnv);
    await next();
  });
  app.use("*", optionalAuth);

  app.get("/healthz", (c) => c.json({ ok: true }));

  const v1 = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: {
              code: "VALIDATION_FAILED",
              message: "Validation failed",
              requestId: c.get("requestId") ?? "unknown",
              fieldErrors: result.error.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
              })),
            },
          },
          400,
        );
      }
    },
  });
  v1.route("/auth", authRoutes());
  v1.route("/", nodeRoutes());
  v1.route("/sync", syncRoutes());
  v1.route("/me", meRoutes());
  v1.route("/", tenantRoutes());
  v1.route("/", projectRoutes());
  v1.route("/", membershipRoutes());
  v1.route("/", credentialRoutes());
  v1.route("/", instanceRoutes());
  v1.route("/", agentProxyRoutes());
  v1.route("/", issueRoutes());
  v1.route("/", sessionRoutes());
  v1.route("/", usageRoutes());
  v1.route("/", configRoutes());
  v1.route("/", commonRoutes());

  // Serve OpenAPI outside auth-gated routers mounted at "/"
  const openApiDoc = v1.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "AgentHub Hub API",
      version: "0.1.0",
    },
  });
  app.get("/v1/openapi.json", (c) => c.json(openApiDoc));

  app.route("/llm", llmProxyRoutes());
  app.route("/v1", v1);

  return { app, db, redis, env: appEnv };
}
