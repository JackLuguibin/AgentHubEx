import { Hono } from "hono";
import type { AppEnv } from "../context.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.js";
import { reencryptStoredSecrets } from "../services/reencrypt.js";

export function kekAdminRoutes() {
  const app = new Hono<AppEnv>();

  app.post("/admin/kek/reencrypt", requireAuth, requirePlatformAdmin, async (c) => {
    const principal = c.get("principal")!;
    const result = await reencryptStoredSecrets(c.get("db"), c.get("env").PLATFORM_DEK, principal.userId);
    return c.json(result);
  });

  return app;
}
