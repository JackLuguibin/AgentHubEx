import { tmpdir } from "node:os";
import { join } from "node:path";
import { listenClaudeWorker } from "@agenthub/worker-claude";
import { AdapterError, basicAuthHeader, parseSseStream } from "@agenthub/adapter-common";
import {
  CLAUDE_CAPABILITIES,
  EnvelopeTypeSchema,
  mapClaudeSdkMessage,
  type ApplyResult,
  type Capabilities,
  type Envelope,
  type InstanceCtx,
  type MessageInput,
  type RuntimeAdapter,
  type VerifyExpectation,
  type VerifyResult,
} from "@agenthub/runtime-contract";

type PartialEnvelope = Omit<Envelope, "seq" | "sessionId"> & { sessionRef?: string };

function isMockInstance(i: InstanceCtx): boolean {
  return i.mock === true || i.baseUrl.startsWith("mock://");
}

async function upstreamFetch(i: InstanceCtx, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const auth = basicAuthHeader(i.auth);
  if (auth) headers.set("authorization", auth);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  const url = `${i.baseUrl.replace(/\/$/, "")}${path}`;
  try {
    return await fetch(url, { ...init, headers });
  } catch (err) {
    throw new AdapterError(
      "UPSTREAM_UNAVAILABLE",
      err instanceof Error ? err.message : "Upstream fetch failed",
    );
  }
}

function textFromParts(parts: MessageInput["parts"]): string {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const liveAdapter: RuntimeAdapter = {
  type: "claude",

  async health(i) {
    const started = Date.now();
    const res = await upstreamFetch(i, "/health").catch(() => null);
    if (!res?.ok) return { ok: false, latencyMs: Date.now() - started };
    const body = await readJson<{ version?: string }>(res).catch(() => null);
    return {
      ok: true,
      latencyMs: Date.now() - started,
      ...(body?.version ? { version: body.version } : {}),
    };
  },

  async capabilities(i) {
    const res = await upstreamFetch(i, "/capabilities");
    if (!res.ok) return CLAUDE_CAPABILITIES;
    const body = await readJson<Capabilities>(res).catch(() => null);
    return body ?? CLAUDE_CAPABILITIES;
  },

  async createSession(i, input) {
    const res = await upstreamFetch(i, "/session", {
      method: "POST",
      body: JSON.stringify({ title: input.title, agent: input.agent }),
    });
    if (!res.ok) {
      throw new AdapterError("UPSTREAM_UNAVAILABLE", `createSession failed: ${res.status}`);
    }
    const body = await readJson<{ id?: string }>(res);
    if (!body.id) throw new AdapterError("UPSTREAM_UNAVAILABLE", "Missing session id");
    return { ref: body.id };
  },

  async sendMessage(i, ref, msg) {
    const res = await upstreamFetch(i, `/session/${encodeURIComponent(ref)}/message`, {
      method: "POST",
      body: JSON.stringify({
        parts: [{ type: "text", text: textFromParts(msg.parts) }],
        model: msg.model,
        agent: msg.agent,
      }),
    });
    if (!res.ok) throw new AdapterError("UPSTREAM_UNAVAILABLE", `sendMessage failed: ${res.status}`);
  },

  async abort(i, ref) {
    const res = await upstreamFetch(i, `/session/${encodeURIComponent(ref)}/abort`, { method: "POST" });
    if (!res.ok) throw new AdapterError("UPSTREAM_UNAVAILABLE", `abort failed: ${res.status}`);
  },

  async listMessages(i, ref) {
    const res = await upstreamFetch(i, `/session/${encodeURIComponent(ref)}/message`);
    if (!res.ok) return { items: [], nextCursor: null };
    const body = await readJson<
      Array<{ id: string; role?: string; parts?: MessageInput["parts"]; createdAt?: string }>
    >(res);
    return {
      items: (Array.isArray(body) ? body : []).map((message) => ({
        id: message.id,
        role: (message.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        parts: message.parts ?? [],
        createdAt: message.createdAt ?? new Date().toISOString(),
      })),
      nextCursor: null,
    };
  },

  async respondPermission(i, ref, reqId, decision) {
    const res = await upstreamFetch(
      i,
      `/session/${encodeURIComponent(ref)}/permissions/${encodeURIComponent(reqId)}`,
      { method: "POST", body: JSON.stringify({ response: decision }) },
    );
    if (!res.ok) throw new AdapterError("UPSTREAM_UNAVAILABLE", `permission failed: ${res.status}`);
  },

  async *events(i, filter, signal) {
    const query = filter.sessionRef ? `?sessionRef=${encodeURIComponent(filter.sessionRef)}` : "";
    const res = await upstreamFetch(i, `/event${query}`, {
      headers: { accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) {
      throw new AdapterError("UPSTREAM_UNAVAILABLE", `events failed: ${res.status}`);
    }
    for await (const frame of parseSseStream(res.body, signal)) {
      if (!frame.data) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(frame.data);
      } catch {
        continue;
      }
      for (const mapped of normalizeWorkerEvent(parsed, filter.sessionRef)) {
        yield mapped;
      }
    }
  },

  async setCredential(i, cred, scope) {
    const res = await upstreamFetch(i, "/internal/credential", {
      method: "PUT",
      body: JSON.stringify({
        provider: cred.provider,
        secret: cred.secret,
        ...(cred.baseUrl ? { baseUrl: cred.baseUrl } : {}),
        sessionRef: scope?.sessionRef,
      }),
    });
    if (!res.ok) throw new AdapterError("UPSTREAM_UNAVAILABLE", `setCredential failed: ${res.status}`);
  },

  async clearCredential(i, provider) {
    const res = await upstreamFetch(i, `/internal/credential/${encodeURIComponent(provider)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new AdapterError("UPSTREAM_UNAVAILABLE", `clearCredential failed: ${res.status}`);
  },

  async applyApiOps(i, ops) {
    const applied: string[] = [];
    for (const op of ops) {
      const path = op.op === "mcp.add" ? "/mcp" : "/config";
      const method = op.op === "mcp.add" ? "POST" : "PATCH";
      const res = await upstreamFetch(i, path, { method, body: JSON.stringify(op) });
      if (!res.ok) throw new AdapterError("UPSTREAM_UNAVAILABLE", `apply failed: ${res.status}`);
      applied.push(op.op === "mcp.add" ? op.name : op.path);
    }
    return { ok: true, applied } satisfies ApplyResult;
  },

  async verifyConfig(i, expected: VerifyExpectation) {
    const res = await upstreamFetch(i, "/mcp");
    if (!res.ok) throw new AdapterError("UPSTREAM_UNAVAILABLE", `verify failed: ${res.status}`);
    const body = await readJson<{ names?: string[] }>(res);
    const mcp = body.names ?? [];
    const wanted = expected.mcp ?? [];
    return { ok: wanted.every((name) => mcp.includes(name)), mcp } satisfies VerifyResult;
  },
};

export function normalizeWorkerEvent(parsed: unknown, sessionRef?: string): PartialEnvelope[] {
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as { type?: string; data?: unknown; ts?: string; raw?: unknown; sessionRef?: string };
  const typeCheck = EnvelopeTypeSchema.safeParse(record.type);
  if (typeCheck.success && record.data && typeof record.data === "object") {
    return [
      {
        v: 1,
        ts: record.ts ?? new Date().toISOString(),
        type: typeCheck.data,
        data: record.data as Envelope["data"],
        sessionRef: record.sessionRef ?? sessionRef,
        ...(record.raw !== undefined ? { raw: record.raw } : {}),
      },
    ];
  }
  return mapClaudeSdkMessage(parsed, "upstream").map((event) => ({
    v: 1 as const,
    ts: new Date().toISOString(),
    type: event.type,
    data: event.data,
    sessionRef,
  }));
}

const EMBEDDED_TOKEN = "mock-password";
let embeddedUrl: Promise<string> | null = null;

function ensureEmbeddedWorker(): Promise<string> {
  if (!embeddedUrl) {
    embeddedUrl = listenClaudeWorker({
      token: EMBEDDED_TOKEN,
      cwd: join(tmpdir(), "agenthub-claude-mock"),
    }).then((worker) => worker.url);
  }
  return embeddedUrl;
}

async function resolveCtx(i: InstanceCtx): Promise<InstanceCtx> {
  if (!isMockInstance(i)) return i;
  return {
    baseUrl: await ensureEmbeddedWorker(),
    auth: { username: "agenthub", password: EMBEDDED_TOKEN },
    mock: false,
    tlsVerify: false,
  };
}

export const claudeAdapter: RuntimeAdapter = {
  type: "claude",
  health: async (i) => liveAdapter.health(await resolveCtx(i)),
  capabilities: async (i) => liveAdapter.capabilities(await resolveCtx(i)),
  createSession: async (i, input) => liveAdapter.createSession(await resolveCtx(i), input),
  sendMessage: async (i, ref, msg) => liveAdapter.sendMessage(await resolveCtx(i), ref, msg),
  abort: async (i, ref) => liveAdapter.abort(await resolveCtx(i), ref),
  listMessages: async (i, ref, page) => liveAdapter.listMessages(await resolveCtx(i), ref, page),
  respondPermission: async (i, ref, reqId, decision) =>
    liveAdapter.respondPermission(await resolveCtx(i), ref, reqId, decision),
  events: (i, filter, signal) => ({
    async *[Symbol.asyncIterator]() {
      yield* liveAdapter.events(await resolveCtx(i), filter, signal);
    },
  }),
  setCredential: async (i, cred, scope) => liveAdapter.setCredential?.(await resolveCtx(i), cred, scope),
  clearCredential: async (i, provider) => liveAdapter.clearCredential?.(await resolveCtx(i), provider),
  applyApiOps: async (i, ops) => {
    const applied = await liveAdapter.applyApiOps?.(await resolveCtx(i), ops);
    if (!applied) throw new AdapterError("UPSTREAM_UNAVAILABLE", "applyApiOps is unavailable");
    return applied;
  },
  verifyConfig: async (i, expected) => {
    const verified = await liveAdapter.verifyConfig?.(await resolveCtx(i), expected);
    if (!verified) throw new AdapterError("UPSTREAM_UNAVAILABLE", "verifyConfig is unavailable");
    return verified;
  },
};

export { isMockInstance };
export default claudeAdapter;
