import { createMiddleware } from "hono/factory";
import { newId } from "../lib/id.js";
import type { AppEnv } from "../context.js";

export const requestIdMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const requestId = incoming && incoming.length > 0 ? incoming : newId();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  await next();
});
