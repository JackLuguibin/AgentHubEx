import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { passwordMatches, type BusEvent } from "@agenthub/worker-common";
import { CLAUDE_CAPABILITIES, type BundleMapInput, type RuntimeApiOp } from "@agenthub/runtime-contract";
import { ClaudeRuntime, type ClaudeRuntimeOptions } from "./runtime.js";

export type ClaudeAppOptions = ClaudeRuntimeOptions & {
  token: string;
  version?: string;
};

export function createClaudeApp(opts: ClaudeAppOptions) {
  const runtime = new ClaudeRuntime(opts);
  const app = new Hono();

  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();
    if (!passwordMatches(c.req.header("authorization"), opts.token)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true, version: opts.version ?? "worker-claude" }));

  app.get("/capabilities", (c) => c.json(CLAUDE_CAPABILITIES));

  app.post("/session", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { title?: string };
    return c.json(runtime.createSession({ title: body.title }), 201);
  });

  app.get("/session/:id/message", (c) => {
    const messages = runtime.listMessages(c.req.param("id"));
    if (!messages) return c.json({ error: "not found" }, 404);
    return c.json(messages);
  });

  app.post("/session/:id/message", async (c) => {
    const body = (await c.req.json()) as { parts?: Array<{ type: string; text?: string }> };
    const ok = await runtime.sendMessage(c.req.param("id"), { parts: body.parts ?? [] });
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true }, 202);
  });

  app.post("/session/:id/abort", (c) => {
    const ok = runtime.abort(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

  app.post("/session/:id/permissions/:reqId", async (c) => {
    const body = (await c.req.json()) as { response?: "allow" | "deny" | "always" };
    const decision = body.response ?? "deny";
    const ok = runtime.resolvePermission(c.req.param("id"), c.req.param("reqId"), decision);
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/event", (c) => {
    const sessionRef = c.req.query("sessionRef") ?? "";
    if (!sessionRef) return c.json({ error: "sessionRef required" }, 400);
    return streamSSE(c, async (stream) => {
      const seen = new Set<string>();
      const queue: BusEvent[] = [];
      let wake: (() => void) | null = null;
      const push = (event: BusEvent) => {
        if (seen.has(event.id)) return;
        seen.add(event.id);
        queue.push(event);
        wake?.();
      };
      const unsubscribe = runtime.bus.subscribe(sessionRef, push);
      for (const event of runtime.bus.snapshot(sessionRef)) push(event);
      try {
        while (!c.req.raw.signal.aborted) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              wake = () => resolve();
              const abort = () => resolve();
              c.req.raw.signal.addEventListener("abort", abort, { once: true });
            });
            wake = null;
            continue;
          }
          const event = queue.shift();
          if (!event) continue;
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify({
              v: event.v,
              ts: event.ts,
              type: event.type,
              data: event.data,
              sessionRef: event.sessionRef,
            }),
          });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.post("/mcp", async (c) => {
    const body = (await c.req.json()) as RuntimeApiOp;
    if (body.op !== "mcp.add" || typeof body.name !== "string") {
      return c.json({ error: "invalid mcp op" }, 400);
    }
    await runtime.applyOp(body);
    return c.json({ ok: true });
  });

  app.patch("/config", async (c) => {
    const body = (await c.req.json()) as RuntimeApiOp;
    if (body.op !== "config.patch" || typeof body.path !== "string") {
      return c.json({ error: "invalid config op" }, 400);
    }
    await runtime.applyOp(body);
    return c.json({ ok: true });
  });

  app.post("/internal/apply", async (c) => {
    const body = (await c.req.json()) as { manifest?: BundleMapInput };
    if (!body.manifest) return c.json({ error: "manifest required" }, 400);
    await runtime.applyManifest(body.manifest);
    return c.json({ ok: true, mcp: runtime.mcpNames() });
  });

  app.get("/mcp", (c) => c.json({ names: runtime.mcpNames() }));

  app.get("/agent", (c) => c.json({ names: runtime.agentNames() }));

  app.put("/internal/credential", async (c) => {
    const body = (await c.req.json()) as {
      provider?: string;
      secret?: string;
      baseUrl?: string;
      sessionRef?: string;
    };
    if (!body.provider || typeof body.secret !== "string") {
      return c.json({ error: "provider and secret required" }, 400);
    }
    runtime.setCredential({
      provider: body.provider,
      secret: body.secret,
      ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}),
      ...(body.sessionRef ? { sessionRef: body.sessionRef } : {}),
    });
    return c.json({ ok: true });
  });

  app.delete("/internal/credential/:provider", (c) => {
    runtime.clearCredential(c.req.param("provider"));
    return c.json({ ok: true });
  });

  return { app, runtime };
}
