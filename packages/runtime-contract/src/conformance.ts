import type { InstanceCtx, RuntimeAdapter } from "./index.js";

type Seen = { type: string; data: Record<string, unknown> };

const PUBLIC_HOST = /anthropic\.com|openai\.com|claude\.ai/i;

function textPart(text: string) {
  return { parts: [{ type: "text" as const, text }] };
}

class Collector {
  private events: Seen[] = [];
  private stop = new AbortController();
  private done = false;

  constructor(
    adapter: RuntimeAdapter,
    ctx: InstanceCtx,
    sessionRef: string,
  ) {
    void this.pump(adapter, ctx, sessionRef);
  }

  private async pump(adapter: RuntimeAdapter, ctx: InstanceCtx, sessionRef: string) {
    try {
      for await (const event of adapter.events(ctx, { sessionRef }, this.stop.signal)) {
        this.events.push({
          type: event.type,
          data: (event.data ?? {}) as Record<string, unknown>,
        });
      }
    } catch {
      /* stream closed */
    } finally {
      this.done = true;
    }
  }

  async waitFor(pred: (event: Seen) => boolean, label: string): Promise<Seen> {
    const started = Date.now();
    while (Date.now() - started < 4_000) {
      const found = this.events.find(pred);
      if (found) return found;
      if (this.done && Date.now() - started > 200) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      `timed out waiting for ${label}; saw ${this.events.map((event) => event.type).join(",") || "nothing"}`,
    );
  }

  close() {
    this.stop.abort();
  }
}

/**
 * Same cases for every runtime (architecture 11.8).
 * Uses a mock provider only. Fails if the run calls a public model host.
 */
export async function runConformance(adapter: RuntimeAdapter, ctx: InstanceCtx): Promise<void> {
  if (!adapter.setCredential || !adapter.applyApiOps || !adapter.verifyConfig) {
    throw new Error("adapter is missing credential or apply methods");
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (PUBLIC_HOST.test(url)) {
      throw new Error(`contract test blocked public network call: ${url}`);
    }
    return originalFetch(input, init);
  };

  try {
    const health = await adapter.health(ctx);
    if (!health.ok) throw new Error("health is not ok");
    const caps = await adapter.capabilities(ctx);
    if (!caps.streaming || !caps.abort || !caps.permissions) {
      throw new Error("runtime is missing streaming, abort, or permissions");
    }

    const created = await adapter.createSession(ctx, { title: "contract" });
    const events = new Collector(adapter, ctx, created.ref);
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      await adapter.sendMessage(ctx, created.ref, textPart("ask permission to use a tool"));
      const asked = await events.waitFor(
        (event) => event.type === "permission_request",
        "permission_request",
      );
      const reqId = String(asked.data.reqId ?? "");
      if (!reqId) throw new Error("permission_request missing reqId");
      await adapter.respondPermission(ctx, created.ref, reqId, "allow");
      await events.waitFor(
        (event) => event.type === "permission_resolved" && event.data.decision === "allow",
        "permission_resolved allow",
      );
      await events.waitFor((event) => event.type === "tool_call", "tool_call");
      await events.waitFor((event) => event.type === "assistant.delta", "assistant.delta");
      await events.waitFor((event) => event.type === "result", "result");

      await adapter.setCredential(
        ctx,
        { provider: "anthropic", secret: "sk-test-not-a-real-key" },
        { sessionRef: created.ref },
      );
      await adapter.sendMessage(ctx, created.ref, textPart("call the model"));
      await events.waitFor(
        (event) => event.type === "usage" && String(event.data.model ?? "").includes("anthropic"),
        "usage from mock provider",
      );
    } finally {
      events.close();
    }

    const abortSession = await adapter.createSession(ctx, { title: "abort" });
    const abortEvents = new Collector(adapter, ctx, abortSession.ref);
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      await adapter.sendMessage(ctx, abortSession.ref, textPart("abort this run"));
      await adapter.abort(ctx, abortSession.ref);
      await abortEvents.waitFor(
        (event) =>
          event.type === "session.status" &&
          event.data.status === "idle" &&
          event.data.reason === "aborted",
        "aborted",
      );
    } finally {
      abortEvents.close();
    }

    const applied = await adapter.applyApiOps(ctx, [
      {
        op: "mcp.add",
        name: "docs",
        config: { type: "remote", url: "http://127.0.0.1:9/mcp" },
      },
    ]);
    if (!applied.ok) throw new Error("applyApiOps failed");
    const verified = await adapter.verifyConfig(ctx, { mcp: ["docs"] });
    if (!verified.ok || !verified.mcp.includes("docs")) {
      throw new Error("MCP server was not visible after apply");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}
