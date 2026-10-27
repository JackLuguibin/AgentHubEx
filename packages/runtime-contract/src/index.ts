import { z } from "zod";

/** Aligned with docs/architecture/11-runtime-contract.md */

export type RuntimeType = "opencode" | "claude";

export type Capabilities = {
  v: 1;
  files: boolean;
  find: boolean;
  lsp: boolean;
  pty: boolean;
  mcpRuntimeAdd: boolean;
  permissions: boolean;
  streaming: boolean;
  abort: boolean;
  usage: boolean;
};

export const DEFAULT_CAPABILITIES: Capabilities = {
  v: 1,
  files: false,
  find: false,
  lsp: false,
  pty: false,
  mcpRuntimeAdd: false,
  permissions: false,
  streaming: true,
  abort: true,
  usage: false,
};

/** OpenCode exposes the workbench file, search, and terminal surfaces. */
export const OPENCODE_CAPABILITIES: Capabilities = {
  v: 1,
  files: true,
  find: true,
  lsp: false,
  pty: true,
  mcpRuntimeAdd: true,
  permissions: true,
  streaming: true,
  abort: true,
  usage: true,
};

/**
 * Claude does not speak the OpenCode file, search, LSP, or PTY APIs.
 * The workbench hides those panes when the flags are false.
 */
export const CLAUDE_CAPABILITIES: Capabilities = {
  v: 1,
  files: false,
  find: false,
  lsp: false,
  pty: false,
  mcpRuntimeAdd: true,
  permissions: true,
  streaming: true,
  abort: true,
  usage: true,
};

export function capabilitiesForRuntime(runtimeType: RuntimeType): Capabilities {
  return runtimeType === "claude" ? CLAUDE_CAPABILITIES : OPENCODE_CAPABILITIES;
}

export type EnvelopeType =
  | "session.status"
  | "message.start"
  | "assistant.delta"
  | "assistant.message"
  | "tool_call"
  | "tool_result"
  | "permission_request"
  | "permission_resolved"
  | "usage"
  | "result"
  | "error";

export type EnvelopeData = {
  "session.status": { status: "busy" | "idle" | "error"; reason?: string };
  "message.start": { messageId: string; role: "assistant" };
  "assistant.delta": { messageId: string; text: string };
  "assistant.message": { messageId: string; text: string };
  "tool_call": { toolId: string; name: string; input: unknown };
  "tool_result": { toolId: string; output: unknown; isError: boolean };
  "permission_request": {
    reqId: string;
    tool: string;
    input: unknown;
    options: Array<"allow" | "deny" | "always">;
  };
  "permission_resolved": {
    reqId: string;
    decision: "allow" | "deny" | "always" | "timeout";
  };
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheRead?: number;
    cost?: number;
  };
  result: { stopReason: string; summary?: string };
  error: { code: string; message: string };
};

export type Envelope<T extends EnvelopeType = EnvelopeType> = {
  v: 1;
  seq: number;
  sessionId: string;
  ts: string;
  type: T;
  data: EnvelopeData[T];
  raw?: unknown;
};

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "file"; path: string }
  | {
      type: "image";
      mime: "image/png" | "image/jpeg" | "image/webp";
      dataBase64: string;
    };

export type MessageInput = {
  parts: MessagePart[];
  model?: string;
  agent?: string;
};

export type InstanceCtx = {
  baseUrl: string;
  auth?: { username: string; password: string };
  tlsVerify?: boolean;
  /** When true, adapter uses in-process mock (no upstream HTTP). */
  mock?: boolean;
};

export type Health = { ok: boolean; latencyMs?: number; version?: string };

export type RuntimeApiOp =
  | { op: "mcp.add"; name: string; config: Record<string, unknown> }
  | { op: "config.patch"; path: string; value: unknown };

export type ApplyResult = { ok: boolean; applied: string[] };

export type VerifyExpectation = { mcp?: string[] };

export type VerifyResult = { ok: boolean; mcp: string[] };

export interface RuntimeAdapter {
  readonly type: RuntimeType;
  health(i: InstanceCtx): Promise<Health>;
  capabilities(i: InstanceCtx): Promise<Capabilities>;
  createSession(
    i: InstanceCtx,
    input: { title?: string; agent?: string },
  ): Promise<{ ref: string }>;
  sendMessage(i: InstanceCtx, ref: string, msg: MessageInput): Promise<void>;
  abort(i: InstanceCtx, ref: string): Promise<void>;
  listMessages(
    i: InstanceCtx,
    ref: string,
    page: { cursor?: string; limit?: number },
  ): Promise<{
    items: Array<{
      id: string;
      role: "user" | "assistant";
      parts: MessagePart[];
      createdAt: string;
    }>;
    nextCursor: string | null;
  }>;
  respondPermission(
    i: InstanceCtx,
    ref: string,
    reqId: string,
    decision: "allow" | "deny" | "always",
  ): Promise<void>;
  events(
    i: InstanceCtx,
    filter: { sessionRef?: string },
    signal?: AbortSignal,
  ): AsyncIterable<Omit<Envelope, "seq" | "sessionId"> & { sessionRef?: string }>;
  setCredential?(
    i: InstanceCtx,
    cred: { provider: string; secret: string; baseUrl?: string },
    scope?: { sessionRef?: string },
  ): Promise<void>;
  clearCredential?(i: InstanceCtx, provider: string): Promise<void>;
  applyApiOps?(i: InstanceCtx, ops: RuntimeApiOp[]): Promise<ApplyResult>;
  verifyConfig?(i: InstanceCtx, expected: VerifyExpectation): Promise<VerifyResult>;
}

export const CapabilitiesSchema = z.object({
  v: z.literal(1),
  files: z.boolean(),
  find: z.boolean(),
  lsp: z.boolean(),
  pty: z.boolean(),
  mcpRuntimeAdd: z.boolean(),
  permissions: z.boolean(),
  streaming: z.boolean(),
  abort: z.boolean(),
  usage: z.boolean(),
});

export const EnvelopeTypeSchema = z.enum([
  "session.status",
  "message.start",
  "assistant.delta",
  "assistant.message",
  "tool_call",
  "tool_result",
  "permission_request",
  "permission_resolved",
  "usage",
  "result",
  "error",
]);

export {
  CLAUDE_BUNDLE_OPTION_MAP,
  CLAUDE_PATHS,
  MANAGED_MANIFEST_PATH,
  OPENCODE_PATHS,
  classifyPermission,
  isAllowedManagedPath,
  mapBundleToClaudeOptions,
} from "./bundle-mapping.js";
export type {
  BundleMapInput,
  ClaudeAgentOptions,
  ClaudeMcpServer,
  ClaudePermissionRule,
} from "./bundle-mapping.js";

export { mapClaudeSdkMessage } from "./claude-events.js";
export type { MappedEvent } from "./claude-events.js";
export { runConformance } from "./conformance.js";

export function makeEnvelope<T extends EnvelopeType>(
  sessionId: string,
  seq: number,
  type: T,
  data: EnvelopeData[T],
  raw?: unknown,
): Envelope<T> {
  return {
    v: 1,
    seq,
    sessionId,
    ts: new Date().toISOString(),
    type,
    data,
    ...(raw !== undefined ? { raw } : {}),
  };
}
