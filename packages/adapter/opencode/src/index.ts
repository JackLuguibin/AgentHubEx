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
      if (!mapped) continue;
      yield {
        v: 1 as const,
        ts: new Date().toISOString(),
        type: mapped.type,
        data: mapped.data,
        sessionRef: sessionID || filter.sessionRef,
        raw: parsed,
      } satisfies PartialEnvelope;
    }
  },
};

function mapLiveEvent(
  type: string,
  props: Record<string, unknown>,
): { type: EnvelopeType; data: Envelope["data"] } | null {
  if (type === "session.idle" || type === "session.status") {
    const status =
      type === "session.idle"
        ? "idle"
        : ((props.status as "busy" | "idle" | "error") ?? "idle");
    return { type: "session.status", data: { status } };
  }
  if (type === "message.part.updated") {
    const part = props.part as { type?: string; text?: string; id?: string } | undefined;
    if (part?.type === "text" && typeof part.text === "string") {
      return {
        type: "assistant.delta",
        data: {
          messageId: String(props.messageID ?? part.id ?? "unknown"),
          text: part.text,
        },
      };
    }
  }
  if (type === "message.updated") {
    const info = props.info as { role?: string; id?: string } | undefined;
    if (info?.role === "assistant") {
      return {
        type: "assistant.message",
        data: {
          messageId: String(info.id ?? "unknown"),
          text: String((props as { text?: string }).text ?? ""),
        },
      };
    }
  }
  if (type === "session.error") {
    return {
      type: "error",
      data: {
        code: "UPSTREAM_ERROR",
        message: String(props.message ?? "Upstream error"),
      },
    };
  }
  return null;
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
};

export { mockOpencodeAdapter, isMockInstance };
export default opencodeAdapter;
