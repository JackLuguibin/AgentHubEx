import { z } from "zod";

/** Skeleton aligned with docs/architecture/11-runtime-contract.md */

export type RuntimeType = "opencode" | "claude";

export type Capabilities = {
  pty: boolean;
  fileWrite: boolean;
  mcp: boolean;
  permissions: boolean;
};

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

export const CapabilitiesSchema = z.object({
  pty: z.boolean(),
  fileWrite: z.boolean(),
  mcp: z.boolean(),
  permissions: z.boolean(),
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

export interface RuntimeAdapter {
  readonly type: RuntimeType;
  health(i: unknown): Promise<{ ok: boolean; latencyMs?: number }>;
  capabilities(i: unknown): Promise<Capabilities>;
}
