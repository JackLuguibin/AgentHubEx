import type { EnvelopeType, InstanceCtx } from "@agenthub/runtime-contract";

export type UpstreamEvent = {
  type: string;
  properties?: Record<string, unknown>;
  data?: unknown;
};

export function basicAuthHeader(auth?: InstanceCtx["auth"]): string | undefined {
  if (!auth?.username) return undefined;
  const token = Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString(
    "base64",
  );
  return `Basic ${token}`;
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): AsyncGenerator<{ event?: string; data: string; id?: string }> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let dataLines: string[] = [];
  let id: string | undefined;

  const flush = (): { event?: string; data: string; id?: string } | null => {
    if (dataLines.length === 0 && !event) return null;
    const data = dataLines.join("\n");
    const out = { event, data, id };
    event = undefined;
    dataLines = [];
    id = undefined;
    return out;
  };

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        if (line === "") {
          const frame = flush();
          if (frame) yield frame;
          continue;
        }
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        } else if (line.startsWith("id:")) {
          id = line.slice(3).trim();
        }
      }
    }
    const frame = flush();
    if (frame) yield frame;
  } finally {
    reader.releaseLock();
  }
}

/** Best-effort map of OpenCode-style event names → Envelope types. */
export function mapOpenCodeEventType(type: string): EnvelopeType | null {
  switch (type) {
    case "session.status":
    case "session.idle":
      return "session.status";
    case "message.part.updated":
      return "assistant.delta";
    case "message.updated":
      return "assistant.message";
    case "permission.updated":
    case "permission.asked":
      return "permission_request";
    case "session.error":
      return "error";
    default:
      return null;
  }
}

export class AdapterError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
    this.status = status;
  }
}
