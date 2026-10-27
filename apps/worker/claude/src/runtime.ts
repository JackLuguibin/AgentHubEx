import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EventBus, createBusEvent } from "@agenthub/worker-common";
import {
  CLAUDE_PATHS,
  mapBundleToClaudeOptions,
  mapClaudeSdkMessage,
  type BundleMapInput,
  type ClaudeAgentOptions,
  type RuntimeApiOp,
} from "@agenthub/runtime-contract";
import { mockClaudeEngine, type ClaudeEngine } from "./engine.js";
import { PermissionBridge, type Scheduler } from "./permission-bridge.js";

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
  createdAt: string;
};

type Session = {
  id: string;
  title: string;
  messages: StoredMessage[];
  abort: AbortController | null;
  settled: boolean;
};

export type ClaudeRuntimeOptions = {
  engine?: ClaudeEngine;
  cwd?: string;
  timeoutMs?: number;
  schedule?: Scheduler;
  bus?: EventBus;
};

export class ClaudeRuntime {
  readonly bus: EventBus;
  private sessions = new Map<string, Session>();
  private mcp = new Map<string, Record<string, unknown>>();
  private agents = new Set<string>();
  private credentials = new Map<string, { provider: string; secret: string; baseUrl?: string }>();
  private options: ClaudeAgentOptions = mapBundleToClaudeOptions({});
  private bridge: PermissionBridge;
  private engine: ClaudeEngine;
  private cwd: string;

  constructor(opts: ClaudeRuntimeOptions = {}) {
    this.bus = opts.bus ?? new EventBus();
    this.engine = opts.engine ?? mockClaudeEngine;
    this.cwd = opts.cwd ?? "/workspace";
    this.options = mapBundleToClaudeOptions({ cwd: this.cwd });
    this.bridge = new PermissionBridge(this.bus, {
      rules: () => this.options.permissionRules,
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.schedule ? { schedule: opts.schedule } : {}),
    });
  }

  createSession(input: { title?: string }) {
    const id = randomUUID();
    this.sessions.set(id, {
      id,
      title: input.title ?? "新会话",
      messages: [],
      abort: null,
      settled: true,
    });
    return { id };
  }

  listMessages(sessionRef: string) {
    return this.sessions.get(sessionRef)?.messages ?? null;
  }

  async sendMessage(
    sessionRef: string,
    input: { parts: Array<{ type: string; text?: string }> },
  ) {
    const session = this.sessions.get(sessionRef);
    if (!session) return false;
    if (session.abort) this.abort(sessionRef);

    const text = input.parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
    const userId = randomUUID();
    session.messages.push({
      id: userId,
      role: "user",
      parts: [{ type: "text", text }],
      createdAt: new Date().toISOString(),
    });

    const messageId = randomUUID();
    const controller = new AbortController();
    session.abort = controller;
    session.settled = false;
    const credential = this.credentials.get(sessionRef) ?? this.credentials.get("*");
    this.emit(sessionRef, "session.status", { status: "busy" });
    this.emit(sessionRef, "message.start", { messageId, role: "assistant" });

    void this.runTurn(session, messageId, text, controller, credential);
    return true;
  }

  abort(sessionRef: string) {
    const session = this.sessions.get(sessionRef);
    if (!session) return false;
    session.abort?.abort();
    session.abort = null;
    if (!session.settled) {
      session.settled = true;
      this.emit(sessionRef, "session.status", { status: "idle", reason: "aborted" });
    }
    return true;
  }

  resolvePermission(sessionRef: string, reqId: string, decision: "allow" | "deny" | "always") {
    return this.bridge.resolve(sessionRef, reqId, decision);
  }

  setCredential(input: { provider: string; secret: string; baseUrl?: string; sessionRef?: string }) {
    const key = input.sessionRef ?? "*";
    this.credentials.set(key, {
      provider: input.provider,
      secret: input.secret,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    });
  }

  /** What the process would use to call a model. Hub sends a proxy token, not the provider key. */
  proxyMaterial(sessionRef?: string) {
    const credential = (sessionRef ? this.credentials.get(sessionRef) : undefined) ?? this.credentials.get("*");
    if (!credential) return null;
    return {
      provider: credential.provider,
      baseUrl: credential.baseUrl ?? null,
      authorization: `Bearer ${credential.secret}`,
    };
  }

  holdsSecret(secret: string) {
    for (const value of this.credentials.values()) {
      if (value.secret === secret || (value.baseUrl ?? "").includes(secret)) return true;
    }
    return false;
  }

  clearCredential(provider: string) {
    for (const [key, value] of this.credentials) {
      if (value.provider === provider) this.credentials.delete(key);
    }
  }

  credentialCount() {
    return this.credentials.size;
  }

  async applyOp(op: RuntimeApiOp) {
    if (op.op === "mcp.add") {
      this.mcp.set(op.name, op.config);
      return op.name;
    }
    if (op.path === "claudeOptions") {
      this.absorbOptions(op.value);
    }
    if (op.path === "model" && typeof op.value === "string") {
      this.options = { ...this.options, model: op.value };
    }
    if (op.path === "agents" && Array.isArray(op.value)) {
      for (const agent of op.value) {
        if (agent && typeof agent === "object" && "name" in agent && typeof agent.name === "string") {
          this.agents.add(agent.name);
        }
      }
    }
    return op.path;
  }

  async applyManifest(manifest: BundleMapInput) {
    const options = mapBundleToClaudeOptions({ ...manifest, cwd: this.cwd });
    await this.absorbOptions(options);
  }

  mcpNames() {
    return [...this.mcp.keys()].sort();
  }

  agentNames() {
    return [...this.agents].sort();
  }

  private async absorbOptions(value: unknown) {
    if (!value || typeof value !== "object") return;
    const options = value as ClaudeAgentOptions;
    this.options = { ...this.options, ...options, cwd: this.cwd };
    for (const name of Object.keys(options.mcpServers ?? {})) {
      this.mcp.set(name, { type: options.mcpServers[name]?.type ?? "http" });
    }
    for (const name of Object.keys(options.agents ?? {})) this.agents.add(name);
    if (typeof options.claudeMd === "string") {
      await mkdir(this.cwd, { recursive: true });
      await writeFile(join(this.cwd, CLAUDE_PATHS.agentsMd), options.claudeMd);
    }
  }

  private async runTurn(
    session: Session,
    messageId: string,
    text: string,
    controller: AbortController,
    credential: { provider: string; secret: string; baseUrl?: string } | undefined,
  ) {
    let assistantText = "";
    try {
      for await (const message of this.engine.run({
        prompt: text,
        messageId,
        options: this.options,
        canUseTool: (tool, input) => this.bridge.canUseTool(session.id, tool, input),
        signal: controller.signal,
        hasCredential: Boolean(credential),
        ...(credential ? { credentialProvider: credential.provider } : {}),
      })) {
        if (controller.signal.aborted || session.settled) return;
        for (const mapped of mapClaudeSdkMessage(message, messageId)) {
          if (mapped.type === "assistant.delta") {
            const delta = mapped.data as { text?: string };
            assistantText += delta.text ?? "";
          }
          if (mapped.type === "assistant.message") {
            const body = mapped.data as { text?: string };
            assistantText = body.text ?? assistantText;
          }
          this.emit(session.id, mapped.type, mapped.data, message);
        }
      }
    } catch (err) {
      if (controller.signal.aborted || session.settled) return;
      this.emit(session.id, "error", {
        code: "UPSTREAM_ERROR",
        message: err instanceof Error ? err.message : "Claude runtime error",
      });
      this.emit(session.id, "session.status", { status: "error" });
      session.settled = true;
      session.abort = null;
      return;
    }

    if (controller.signal.aborted || session.settled) return;
    if (assistantText) {
      session.messages.push({
        id: messageId,
        role: "assistant",
        parts: [{ type: "text", text: assistantText }],
        createdAt: new Date().toISOString(),
      });
    }
    session.settled = true;
    session.abort = null;
    this.emit(session.id, "session.status", { status: "idle" });
  }

  private emit(sessionRef: string, type: string, data: unknown, raw?: unknown) {
    this.bus.publish(createBusEvent(sessionRef, type, data, raw));
  }
}
