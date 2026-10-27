import type { EnvelopeData, EnvelopeType } from "./index.js";

export type MappedEvent = {
  type: EnvelopeType;
  data: EnvelopeData[EnvelopeType];
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Claude Agent SDK message → runtime-contract envelopes. See architecture 11.4. */
export function mapClaudeSdkMessage(message: unknown, messageId: string): MappedEvent[] {
  const msg = record(message);
  if (!msg) return [];

  if (msg.type === "stream_event") {
    const event = record(msg.event);
    const delta = record(event?.delta);
    if (
      event?.type === "content_block_delta" &&
      delta?.type === "text_delta" &&
      typeof delta.text === "string"
    ) {
      return [{ type: "assistant.delta", data: { messageId, text: delta.text } }];
    }
    return [];
  }

  if (msg.type === "assistant") {
    const body = record(msg.message);
    const id = String(body?.id ?? messageId);
    const content = Array.isArray(body?.content) ? body.content : [];
    const out: MappedEvent[] = [];
    const texts: string[] = [];
    for (const block of content) {
      const item = record(block);
      if (!item) continue;
      if (item.type === "text" && typeof item.text === "string") texts.push(item.text);
      if (item.type === "tool_use") {
        out.push({
          type: "tool_call",
          data: {
            toolId: String(item.id ?? "tool"),
            name: String(item.name ?? "tool"),
            input: item.input,
          },
        });
      }
    }
    if (texts.length > 0) {
      out.push({ type: "assistant.message", data: { messageId: id, text: texts.join("") } });
    }
    return out;
  }

  if (msg.type === "user") {
    const body = record(msg.message);
    const content = Array.isArray(body?.content) ? body.content : [];
    const out: MappedEvent[] = [];
    for (const block of content) {
      const item = record(block);
      if (!item || item.type !== "tool_result") continue;
      out.push({
        type: "tool_result",
        data: {
          toolId: String(item.tool_use_id ?? item.toolId ?? "tool"),
          output: item.content ?? item.output,
          isError: Boolean(item.is_error ?? item.isError),
        },
      });
    }
    return out;
  }

  if (msg.type === "result") {
    const out: MappedEvent[] = [];
    const usage = record(msg.usage);
    if (usage) {
      const cacheRead = usage.cache_read_input_tokens;
      out.push({
        type: "usage",
        data: {
          model: String(msg.model ?? "claude"),
          inputTokens: Number(usage.input_tokens ?? 0),
          outputTokens: Number(usage.output_tokens ?? 0),
          ...(typeof cacheRead === "number" ? { cacheRead } : {}),
        },
      });
    }
    if (msg.is_error === true) {
      out.push({
        type: "error",
        data: {
          code: String(msg.subtype ?? "UPSTREAM_ERROR"),
          message: String(msg.result ?? "Claude runtime error"),
        },
      });
    }
    out.push({
      type: "result",
      data: {
        stopReason: String(msg.subtype ?? (msg.is_error ? "error" : "end_turn")),
        ...(typeof msg.result === "string" ? { summary: msg.result } : {}),
      },
    });
    return out;
  }

  return [];
}
