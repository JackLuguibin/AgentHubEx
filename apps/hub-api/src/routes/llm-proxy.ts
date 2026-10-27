import { Hono } from "hono";
import type { AppEnv } from "../context.js";
import { handleLlmProxy } from "../services/llm-proxy.js";

/** Mounted at /llm. Runtime calls POST /llm/{provider}/v1/messages with a proxy token. */
export function llmProxyRoutes() {
  const app = new Hono<AppEnv>();
  app.all("/*", async (c) => {
    if (c.req.method !== "POST") {
      return c.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "LLM proxy only accepts POST",
            requestId: c.get("requestId") ?? "unknown",
          },
        },
        400,
      );
    }
    return handleLlmProxy(c);
  });
  return app;
}
