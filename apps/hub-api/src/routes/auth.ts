import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  LoginReqSchema,
  LoginResSchema,
  ManifestSchema,
  MeSchema,
  RegisterReqSchema,
  SwitchTenantReqSchema,
} from "@agenthub/domain";
import type { AppEnv } from "../context.js";
import { requireAuth } from "../middleware/auth.js";
import {
  buildMe,
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
  switchTenant,
} from "../services/auth.js";
import { getUserOrThrow } from "../services/users.js";
import { saveUserOverlay } from "../services/config-bundles.js";
import { unauthenticated } from "../errors.js";
import { meCredentialRoutes } from "./credentials.js";

const REFRESH_COOKIE = "ah_refresh";

function setRefreshCookie(
  c: { header: (k: string, v: string) => void },
  token: string,
  secure: boolean,
) {
  const parts = [
    `${REFRESH_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/v1/auth",
    "SameSite=Strict",
    `Max-Age=${7 * 24 * 60 * 60}`,
  ];
  if (secure) parts.push("Secure");
  c.header("Set-Cookie", parts.join("; "));
}

function clearRefreshCookie(
  c: { header: (k: string, v: string) => void },
  secure: boolean,
) {
  const parts = [
    `${REFRESH_COOKIE}=`,
    "HttpOnly",
    "Path=/v1/auth",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  c.header("Set-Cookie", parts.join("; "));
}

function readRefreshCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (part.startsWith(`${REFRESH_COOKIE}=`)) {
      return part.slice(REFRESH_COOKIE.length + 1);
    }
  }
  return undefined;
}

function openApiApp() {
  return new OpenAPIHono<AppEnv>({
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
}

export function authRoutes() {
  const app = openApiApp();

  const registerRoute = createRoute({
    method: "post",
    path: "/register",
    tags: ["auth"],
    request: {
      body: {
        content: { "application/json": { schema: RegisterReqSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: LoginResSchema } },
        description: "Registered",
      },
    },
  });

  app.openapi(registerRoute, async (c) => {
    const body = c.req.valid("json");
    const result = await registerUser(
      c.get("db"),
      c.get("redis"),
      {
        access: c.get("env").JWT_ACCESS_SECRET,
        refresh: c.get("env").JWT_REFRESH_SECRET,
      },
      body,
    );
    setRefreshCookie(c, result.refreshToken, c.get("env").COOKIE_SECURE);
    return c.json(
      {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        user: result.user,
      },
      201,
    );
  });

  const loginRoute = createRoute({
    method: "post",
    path: "/login",
    tags: ["auth"],
    request: {
      body: {
        content: { "application/json": { schema: LoginReqSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: LoginResSchema } },
        description: "Logged in",
      },
    },
  });

  app.openapi(loginRoute, async (c) => {
    const body = c.req.valid("json");
    const result = await loginUser(
      c.get("db"),
      c.get("redis"),
      {
        access: c.get("env").JWT_ACCESS_SECRET,
        refresh: c.get("env").JWT_REFRESH_SECRET,
      },
      body,
    );
    setRefreshCookie(c, result.refreshToken, c.get("env").COOKIE_SECURE);
    return c.json({
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    });
  });

  const refreshRoute = createRoute({
    method: "post",
    path: "/refresh",
    tags: ["auth"],
    responses: {
      200: {
        content: { "application/json": { schema: LoginResSchema } },
        description: "Refreshed",
      },
    },
  });

  app.openapi(refreshRoute, async (c) => {
    const token = readRefreshCookie(c.req.header("cookie"));
    if (!token) throw unauthenticated("Missing refresh cookie");
    const result = await refreshSession(
      c.get("db"),
      c.get("redis"),
      {
        access: c.get("env").JWT_ACCESS_SECRET,
        refresh: c.get("env").JWT_REFRESH_SECRET,
      },
      token,
    );
    setRefreshCookie(c, result.refreshToken, c.get("env").COOKIE_SECURE);
    return c.json({
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    });
  });

  app.post("/logout", async (c) => {
    const token = readRefreshCookie(c.req.header("cookie"));
    await logoutSession(c.get("redis"), token, c.get("env").JWT_REFRESH_SECRET);
    clearRefreshCookie(c, c.get("env").COOKIE_SECURE);
    return c.body(null, 204);
  });

  app.use("/switch-tenant", requireAuth);
  app.post("/switch-tenant", async (c) => {
    const body = SwitchTenantReqSchema.parse(await c.req.json());
    const principal = c.get("principal")!;
    const result = await switchTenant(
      c.get("db"),
      c.get("redis"),
      {
        access: c.get("env").JWT_ACCESS_SECRET,
        refresh: c.get("env").JWT_REFRESH_SECRET,
      },
      principal.userId,
      body.tenantId,
    );
    setRefreshCookie(c, result.refreshToken, c.get("env").COOKIE_SECURE);
    return c.json({
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    });
  });

  return app;
}

export function meRoutes() {
  const app = openApiApp();
  app.use("*", requireAuth);

  const meRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["auth"],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        content: { "application/json": { schema: MeSchema } },
        description: "Current user",
      },
    },
  });

  app.openapi(meRoute, async (c) => {
    const principal = c.get("principal")!;
    const user = await getUserOrThrow(c.get("db"), principal.userId);
    const me = await buildMe(c.get("db"), user, principal.tenantId);
    return c.json(me);
  });

  app.route("/", meCredentialRoutes());

  app.put("/projects/:p/overlay", async (c) => {
    const body = ManifestSchema.parse(await c.req.json());
    const principal = c.get("principal")!;
    return c.json(
      await saveUserOverlay(c.get("db"), c.req.param("p"), {
        userId: principal.userId,
        isPlatformAdmin: principal.isPlatformAdmin,
      }, body),
    );
  });

  return app;
}
