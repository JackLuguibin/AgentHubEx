import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.js";
import { requireNodeFingerprint } from "../lib/node-peer.js";
import {
  createBootstrapToken,
  heartbeatNode,
  listNodes,
  patchNode,
  registerNode,
  renewNodeCert,
} from "../services/nodes.js";

const Capacity = z.object({
  cpu: z.number().positive(),
  memMb: z.number().int().positive(),
  diskGb: z.number().int().positive(),
  maxWorkspaces: z.number().int().positive(),
});

const RegisterBody = z.object({
  token: z.string().min(16),
  csr: z.string().min(32).max(16_000),
  capacity: Capacity,
  labels: z.record(z.string()).default({}),
  agentVersion: z.string().regex(/^\d+\.\d+\.\d+/),
  hostname: z.string().max(128).optional(),
});

const HeartbeatBody = z.object({
  used: z.object({
    cpu: z.number().nonnegative(),
    memMb: z.number().nonnegative(),
    diskGb: z.number().nonnegative(),
    workspaces: z.number().int().nonnegative(),
  }),
  workspaces: z.array(
    z.object({
      id: z.string().uuid(),
      state: z.enum(["running", "stopped", "missing"]),
      containerId: z.string().optional(),
    }),
  ),
  agentVersion: z.string(),
  wallTime: z.string().min(10),
  advertiseUrl: z.string().optional(),
});

export function nodeRoutes() {
  const app = new Hono<AppEnv>();

  app.post("/nodes/register", async (c) => {
    const body = RegisterBody.parse(await c.req.json());
    return c.json(await registerNode(c.get("db"), c.get("env").NODE_CA_DIR, body), 201);
  });

  app.post("/nodes/heartbeat", async (c) => {
    const fingerprint = requireNodeFingerprint();
    const body = HeartbeatBody.parse(await c.req.json());
    return c.json(
      await heartbeatNode(c.get("db"), c.get("redis"), fingerprint, c.get("env").MIN_AGENT_VERSION, body),
    );
  });

  app.post("/nodes/cert/renew", async (c) => {
    const fingerprint = requireNodeFingerprint();
    const body = z.object({ csr: z.string().min(32).max(16_000) }).parse(await c.req.json());
    return c.json(await renewNodeCert(c.get("db"), c.get("env").NODE_CA_DIR, fingerprint, body.csr));
  });

  app.get("/admin/nodes", requireAuth, requirePlatformAdmin, async (c) => {
    return c.json(await listNodes(c.get("db")));
  });

  app.post("/admin/nodes/bootstrap-tokens", requireAuth, requirePlatformAdmin, async (c) => {
    const body = z
      .object({
        labels: z.record(z.string()).optional(),
        ttlMinutes: z.number().int().optional(),
      })
      .parse(await c.req.json().catch(() => ({})));
    const p = c.get("principal")!;
    return c.json(
      await createBootstrapToken(c.get("db"), p.userId, c.get("env").PUBLIC_BASE_URL, {
        ...body,
        mtlsPort: c.get("env").NODE_MTLS_PORT,
      }),
      201,
    );
  });

  app.patch("/admin/nodes/:id", requireAuth, requirePlatformAdmin, async (c) => {
    const body = z
      .object({
        status: z.enum(["draining", "active", "disabled"]).optional(),
        labels: z.record(z.string()).optional(),
      })
      .parse(await c.req.json());
    return c.json(await patchNode(c.get("db"), c.req.param("id"), body));
  });

  return app;
}
