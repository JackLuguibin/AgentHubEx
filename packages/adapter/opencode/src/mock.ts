import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  Envelope,
  EnvelopeType,
  InstanceCtx,
  MessageInput,
  RuntimeAdapter,
} from "@agenthub/runtime-contract";
import { DEFAULT_CAPABILITIES } from "@agenthub/runtime-contract";

type PartialEnvelope = Omit<Envelope, "seq" | "sessionId"> & { sessionRef?: string };

type SessionState = {
  title: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    parts: MessageInput["parts"];
    createdAt: string;
  }>;
  bus: EventEmitter;
  /** Ring buffer so a late SSE subscriber still sees recent deltas. */
  recent: PartialEnvelope[];
};

const sessions = new Map<string, SessionState>();

function emit(state: SessionState, sessionRef: string, type: EnvelopeType, data: unknown) {
  const evt: PartialEnvelope = {
    v: 1,
    ts: new Date().toISOString(),
    type,
    data: data as Envelope["data"],
    sessionRef,
  };
  state.recent.push(evt);
  if (state.recent.length > 200) state.recent.shift();
  state.bus.emit("event", evt);
}

async function streamReply(sessionRef: string, userText: string) {
  const state = sessions.get(sessionRef);
  if (!state) return;

  const messageId = randomUUID();
  emit(state, sessionRef, "session.status", { status: "busy" });
  emit(state, sessionRef, "message.start", { messageId, role: "assistant" });

  const toolId = randomUUID();
  emit(state, sessionRef, "tool_call", {
    toolId,
    name: "read",
    input: { path: "README.md" },
  });
  emit(state, sessionRef, "tool_result", {
    toolId,
    output: "mock: README.md",
    isError: false,
  });
  if (/权限|permission/i.test(userText)) {
    emit(state, sessionRef, "permission_request", {
      reqId: randomUUID(),
      tool: "bash",
      input: { command: "ls" },
      options: ["allow", "deny"],
    });
  }

  const reply =
    userText.trim().length === 0
      ? "（空消息）这是 Hub mock runtime 的占位回复。"
      : `收到：${userText}\n\n—— 来自内网 mock runtime（非公网 LLM）。`;

  const chunkSize = 8;
  for (let i = 0; i < reply.length; i += chunkSize) {
    const text = reply.slice(i, i + chunkSize);
    emit(state, sessionRef, "assistant.delta", { messageId, text });
    await new Promise((r) => setTimeout(r, 40));
  }

  emit(state, sessionRef, "assistant.message", { messageId, text: reply });
  state.messages.push({
    id: messageId,
    role: "assistant",
    parts: [{ type: "text", text: reply }],
    createdAt: new Date().toISOString(),
  });
  emit(state, sessionRef, "result", { stopReason: "end_turn", summary: "mock complete" });
  emit(state, sessionRef, "session.status", { status: "idle" });
}

export const mockOpencodeAdapter: RuntimeAdapter = {
  type: "opencode",

  async health() {
    return { ok: true, latencyMs: 1, version: "mock-opencode" };
  },

  async capabilities() {
    return {
      ...DEFAULT_CAPABILITIES,
      files: true,
      find: true,
      permissions: true,
      streaming: true,
      abort: true,
      pty: true,
    };
  },

  async createSession(_i, input) {
    const ref = `mock_${randomUUID()}`;
    sessions.set(ref, {
      title: input.title ?? "新会话",
      messages: [],
      bus: new EventEmitter(),
      recent: [],
    });
    return { ref };
  },

  async sendMessage(_i, ref, msg) {
    const state = sessions.get(ref);
    if (!state) throw new Error(`Unknown mock session ${ref}`);
    const text = msg.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    const userId = randomUUID();
    state.messages.push({
      id: userId,
      role: "user",
      parts: msg.parts,
      createdAt: new Date().toISOString(),
    });
    void streamReply(ref, text);
  },

  async abort(_i, ref) {
    const state = sessions.get(ref);
    if (!state) return;
    emit(state, ref, "session.status", { status: "idle", reason: "aborted" });
  },

  async listMessages(_i, ref) {
    const state = sessions.get(ref);
    return { items: state?.messages ?? [], nextCursor: null };
  },

  async respondPermission() {
    /* mock: no-op */
  },

  async *events(_i, filter, signal) {
    if (!filter.sessionRef) return;
    const state = sessions.get(filter.sessionRef);
    if (!state) return;

    const queue: PartialEnvelope[] = [...state.recent];
    let wake: (() => void) | null = null;
    const onEvent = (evt: PartialEnvelope) => {
      queue.push(evt);
      wake?.();
    };
    state.bus.on("event", onEvent);

    const onAbort = () => {
      wake?.();
    };
    signal?.addEventListener("abort", onAbort);

    try {
      while (!signal?.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
          if (signal?.aborted) break;
        }
        while (queue.length > 0) {
          const evt = queue.shift()!;
          yield evt;
        }
      }
    } finally {
      state.bus.off("event", onEvent);
      signal?.removeEventListener("abort", onAbort);
    }
  },
};

export function isMockInstance(i: InstanceCtx): boolean {
  return i.mock === true || i.baseUrl.startsWith("mock://");
}
