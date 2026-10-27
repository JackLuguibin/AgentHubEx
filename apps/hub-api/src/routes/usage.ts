import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { AppError } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import { listProjectUsage, listTenantUsage } from "../services/usage.js";

const Query = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  groupBy: z.enum(["project", "user", "day", "credential"]).optional(),
});

function windowOf(raw: z.infer<typeof Query>) {
  const to = raw.to ? new Date(raw.to) : new Date(Date.now() + 60_000);
  const from = raw.from ? new Date(raw.from) : new Date(to.getTime() - 31 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new AppError(400, "VALIDATION_FAILED", "from and to must be valid times");
  }
  return { from, to, groupBy: raw.groupBy ?? "credential" } as const;
}

export function usageRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/tenants/:t/usage", async (c) => {
    const principal = c.get("principal")!;
    const query = windowOf(Query.parse(c.req.query()));
    if (query.from >= query.to) {
      return c.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "from must be before to",
            requestId: c.get("requestId") ?? "unknown",
          },
        },
        400,
      );
    }
    return c.json(
      await listTenantUsage(
        c.get("db"),
        c.req.param("t"),
        principal.userId,
        principal.isPlatformAdmin,
        query,
      ),
    );
  });

  app.get("/projects/:p/usage", async (c) => {
    const principal = c.get("principal")!;
    const query = windowOf(Query.parse(c.req.query()));
    if (query.from >= query.to) {
      return c.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "from must be before to",
            requestId: c.get("requestId") ?? "unknown",
          },
        },
        400,
      );
    }
    return c.json(
      await listProjectUsage(
        c.get("db"),
        c.req.param("p"),
        principal.userId,
        principal.isPlatformAdmin,
        query,
      ),
    );
  });

  return app;
}
