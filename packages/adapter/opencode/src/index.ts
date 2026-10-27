import {
  AdapterError,
  basicAuthHeader,
  parseSseStream,
} from "@agenthub/adapter-common";
import type {
  Envelope,
  EnvelopeType,
  InstanceCtx,
  MessageInput,
  RuntimeAdapter,
} from "@agenthub/runtime-contract";
import { DEFAULT_CAPABILITIES } from "@agenthub/runtime-contract";
import { isMockInstance, mockOpencodeAdapter } from "./mock.js";

type PartialEnvelope = Omit<Envelope, "seq" | "sessionId"> & { sessionRef?: string };

async function upstreamFetch(
  i: InstanceCtx,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const auth = basicAuthHeader(i.auth);
  if (auth) headers.set("authorization", auth);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
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
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

const liveAdapter: RuntimeAdapter = {
  type: "opencode",

  async health(i) {
    const started = Date.now();
    const res = await upstreamFetch(i, "/global/health").catch(() => null);
    if (!res?.ok) {
      const res2 = await upstreamFetch(i, "/").catch(() => null);
      return { ok: Boolean(res2?.ok), latencyMs: Date.now() - started };
    }
    return { ok: true, latencyMs: Date.now() - started };
  },

  async capabilities() {
    return {
      ...DEFAULT_CAPABILITIES,
      files: true,
      find: true,
      streaming: true,
      abort: true,
      permissions: true,
      pty: true,
    };
  },

  async createSession(i, input) {
    const res = await upstreamFetch(i, "/session", {
      method: "POST",
      body: JSON.stringify({ title: input.title, agent: input.agent }),
    });
    if (!res.ok) {
      throw new AdapterError(
        "UPSTREAM_UNAVAILABLE",
        `createSession failed: ${res.status}`,
        res.status >= 500 ? 502 : 409,
      );
    }
    const body = (await res.json()) as { id?: string };
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
    if (!res.ok) {
      throw new AdapterError(
        "UPSTREAM_UNAVAILABLE",
        `sendMessage failed: ${res.status}`,
      );
    }
  },

  async abort(i, ref) {
    await upstreamFetch(i, `/session/${encodeURIComponent(ref)}/abort`, {
      method: "POST",
    });
  },

  async listMessages(i, ref) {
    const res = await upstreamFetch(i, `/session/${encodeURIComponent(ref)}/message`);
    if (!res.ok) return { items: [], nextCursor: null };
    const body = (await res.json()) as Array<{
      id: string;
      role?: string;
      parts?: MessageInput["parts"];
      time?: { created?: number };
    }>;
    return {
      items: (Array.isArray(body) ? body : []).map((m) => ({
        id: m.id,
        role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        parts: m.parts ?? [],
        createdAt: new Date(m.time?.created ?? Date.now()).toISOString(),
      })),
      nextCursor: null,
    };
  },

  async respondPermission(i, ref, reqId, decision) {
    await upstreamFetch(
      i,
      `/session/${encodeURIComponent(ref)}/permissions/${encodeURIComponent(reqId)}`,
      {
        method: "POST",
        body: JSON.stringify({ response: decision }),
      },
    );
  },

  async *events(i, filter, signal) {
    const res = await upstreamFetch(i, "/event", {
      headers: { accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) {
      throw new AdapterError("UPSTREAM_UNAVAILABLE", `events failed: ${res.status}`);
    }

    for await (const frame of parseSseStream(res.body, signal)) {
      if (!frame.data) continue;
      let parsed: {
        type?: string;
        properties?: Record<string, unknown>;
      };
      try {
        parsed = JSON.parse(frame.data) as typeof parsed;
      } catch {
        continue;
      }
      const props = parsed.properties ?? {};
      const sessionID = String(props.sessionID ?? props.sessionId ?? "");
      if (filter.sessionRef && sessionID && sessionID !== filter.sessionRef) {
        continue;
      }

      const mapped = mapLiveEvent(parsed.type ?? frame.event ?? "unknown", props);
      for (const item of mapped) {
        yield {
          v: 1 as const,
          ts: new Date().toISOString(),
          type: item.type,
          data: item.data,
          sessionRef: sessionID || filter.sessionRef,
          raw: parsed,
        } satisfies PartialEnvelope;
      }
    }
  },

  async setCredential(i, cred) {
    const res = await upstreamFetch(i, `/auth/${encodeURIComponent(cred.provider)}`, {
      method: "PUT",
      body: JSON.stringify({
        type: "api",
        key: cred.secret,
        ...(cred.baseUrl ? { baseURL: cred.baseUrl } : {}),
      }),
    });
    if (!res.ok) {
      throw new AdapterError("UPSTREAM_UNAVAILABLE", `setCredential failed: ${res.status}`);
    }
  },
};

function mapLiveEvent(
  type: string,
  props: Record<string, unknown>,
): Array<{ type: EnvelopeType; data: Envelope["data"] }> {
  if (type === "session.idle") {
    return [
      { type: "session.status", data: { status: "idle" } },
      { type: "result", data: { stopReason: "idle" } },
    ];
  }
  if (type === "session.status") {
    const status = (props.status as "busy" | "idle" | "error") ?? "idle";
    return [{ type: "session.status", data: { status } }];
  }
  if (type === "message.part.updated") {
    const part = props.part as
      | {
          type?: string;
          text?: string;
          id?: string;
          tool?: string;
          name?: string;
          input?: unknown;
          state?: { status?: string; output?: unknown; error?: unknown };
        }
      | undefined;
    if (part?.type === "text" && typeof part.text === "string") {
      return [
        {
          type: "assistant.delta",
          data: {
            messageId: String(props.messageID ?? part.id ?? "unknown"),
            text: part.text,
          },
        },
      ];
    }
    if (part?.type === "tool") {
      const status = part.state?.status;
      const toolId = String(part.id ?? "tool");
      const name = String(part.tool ?? part.name ?? "tool");
      if (status === "running") {
        return [{ type: "tool_call", data: { toolId, name, input: part.input ?? {} } }];
      }
      if (status === "completed" || status === "error") {
        return [
          {
            type: "tool_result",
            data: {
              toolId,
              output: status === "error" ? part.state?.error : part.state?.output,
              isError: status === "error",
            },
          },
        ];
      }
    }
  }
  if (type === "message.updated") {
    const info = props.info as {
      role?: string;
      id?: string;
      modelID?: string;
      tokens?: { input?: number; output?: number; cache?: { read?: number } };
      cost?: number;
    } | undefined;
    const out: Array<{ type: EnvelopeType; data: Envelope["data"] }> = [];
    if (info?.role === "assistant") {
      out.push({
        type: "assistant.message",
        data: {
          messageId: String(info.id ?? "unknown"),
          text: String((props as { text?: string }).text ?? ""),
        },
      });
      if (info.tokens) {
        out.push({
          type: "usage",
          data: {
            model: String(info.modelID ?? "opencode"),
            inputTokens: info.tokens.input ?? 0,
            outputTokens: info.tokens.output ?? 0,
            ...(info.tokens.cache?.read != null ? { cacheRead: info.tokens.cache.read } : {}),
            ...(info.cost != null ? { cost: info.cost } : {}),
          },
        });
      }
    }
    return out;
  }
  if (type === "permission.asked" || type === "permission.updated") {
    const fallback = ["allow", "deny", "always"] as Array<"allow" | "deny" | "always">;
    const options = Array.isArray(props.options)
      ? props.options.filter(
          (item): item is "allow" | "deny" | "always" =>
            item === "allow" || item === "deny" || item === "always",
        )
      : fallback;
    return [
      {
        type: "permission_request",
        data: {
          reqId: String(props.id ?? props.requestID ?? "permission"),
          tool: String(props.permission ?? props.tool ?? "tool"),
          input: props.input ?? props.patterns ?? {},
          options: options.length > 0 ? options : fallback,
        },
      },
    ];
  }
  if (type === "session.error") {
    return [
      {
        type: "error",
        data: {
          code: "UPSTREAM_ERROR",
          message: String(props.message ?? "Upstream error"),
        },
      },
    ];
  }
  return [];
}

export const opencodeAdapter: RuntimeAdapter = {
  type: "opencode",
  health(i) {
    return isMockInstance(i) ? mockOpencodeAdapter.health(i) : liveAdapter.health(i);
  },
  capabilities(i) {
    return isMockInstance(i)
      ? mockOpencodeAdapter.capabilities(i)
      : liveAdapter.capabilities(i);
  },
  createSession(i, input) {
    return isMockInstance(i)
      ? mockOpencodeAdapter.createSession(i, input)
      : liveAdapter.createSession(i, input);
  },
  sendMessage(i, ref, msg) {
    return isMockInstance(i)
      ? mockOpencodeAdapter.sendMessage(i, ref, msg)
      : liveAdapter.sendMessage(i, ref, msg);
  },
  abort(i, ref) {
    return isMockInstance(i)
      ? mockOpencodeAdapter.abort(i, ref)
      : liveAdapter.abort(i, ref);
  },
  listMessages(i, ref, page) {
    return isMockInstance(i)
      ? mockOpencodeAdapter.listMessages(i, ref, page)
      : liveAdapter.listMessages(i, ref, page);
  },
  respondPermission(i, ref, reqId, decision) {
    return isMockInstance(i)
      ? mockOpencodeAdapter.respondPermission(i, ref, reqId, decision)
      : liveAdapter.respondPermission(i, ref, reqId, decision);
  },
  events(i, filter, signal) {
    return isMockInstance(i)
      ? mockOpencodeAdapter.events(i, filter, signal)
      : liveAdapter.events(i, filter, signal);
  },
  setCredential(i, cred, scope) {
    if (isMockInstance(i)) {
      if (!mockOpencodeAdapter.setCredential) {
        return Promise.reject(new AdapterError("NOT_SUPPORTED", "OpenCode credential injection is unavailable"));
      }
      return mockOpencodeAdapter.setCredential(i, cred, scope);
    }
    if (!liveAdapter.setCredential) {
      return Promise.reject(new AdapterError("NOT_SUPPORTED", "OpenCode credential injection is unavailable"));
    }
    return liveAdapter.setCredential(i, cred, scope);
  },
  clearCredential(i, provider) {
    if (!isMockInstance(i) || !mockOpencodeAdapter.clearCredential) {
      return Promise.reject(new AdapterError("NOT_SUPPORTED", "OpenCode credential clear is unavailable"));
    }
    return mockOpencodeAdapter.clearCredential(i, provider);
  },
  applyApiOps(i, ops) {
    if (!isMockInstance(i) || !mockOpencodeAdapter.applyApiOps) {
      return Promise.reject(new AdapterError("NOT_SUPPORTED", "OpenCode apply is unavailable"));
    }
    return mockOpencodeAdapter.applyApiOps(i, ops);
  },
  verifyConfig(i, expected) {
    if (!isMockInstance(i) || !mockOpencodeAdapter.verifyConfig) {
      return Promise.reject(new AdapterError("NOT_SUPPORTED", "OpenCode verify is unavailable"));
    }
    return mockOpencodeAdapter.verifyConfig(i, expected);
  },
};

export { mockOpencodeAdapter, isMockInstance };
export default opencodeAdapter;
