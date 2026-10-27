export type ParsedUsage = {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costMicros: number | null;
  seen: boolean;
};

const SAFE_REQUEST_HEADERS = ["content-type", "accept", "anthropic-version", "anthropic-beta"];

export function providerUpstreamUrl(baseUrl: string, restPath: string): string {
  const base = new URL(baseUrl);
  if (!restPath.startsWith("/") || restPath.startsWith("//") || restPath.includes("\\")) {
    throw new Error("invalid upstream path");
  }
  const rest = new URL(restPath, base.origin);
  if (rest.origin !== base.origin) throw new Error("invalid upstream path");
  const basePath = base.pathname.replace(/\/$/, "");
  const restPathname = rest.pathname;
  const path =
    basePath && (restPathname === basePath || restPathname.startsWith(`${basePath}/`))
      ? restPathname
      : `${basePath}${restPathname}`;
  const upstream = new URL(path, base.origin);
  if (upstream.origin !== base.origin) throw new Error("invalid upstream path");
  upstream.search = rest.search || base.search;
  return upstream.toString();
}

/** Provider call headers. The inbound proxy token is never copied through. */
export function upstreamAuthHeaders(provider: string, secret: string, incoming: Headers): Headers {
  const headers = new Headers();
  for (const name of SAFE_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (provider === "anthropic") {
    headers.set("x-api-key", secret);
    if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  } else {
    headers.set("authorization", `Bearer ${secret}`);
  }
  return headers;
}

export function createUsageAccumulator(requestModel?: string) {
  const usage: ParsedUsage = {
    ...(requestModel ? { model: requestModel } : {}),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costMicros: null,
    seen: false,
  };
  let pending = "";
  let captured = "";

  const push = (text: string) => {
    if (captured.length < 2_000_000) captured += text;
    pending += text;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) absorbLine(line, usage);
  };

  const finish = () => {
    if (pending) absorbLine(pending, usage);
    const trimmed = captured.trim();
    if (trimmed.startsWith("{")) absorbJson(trimmed, usage);
    pending = "";
  };

  return { usage, push, finish };
}

function absorbLine(line: string, usage: ParsedUsage) {
  const trimmed = line.trim();
  if (!trimmed) return;
  const data = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!data || data === "[DONE]" || !data.startsWith("{")) return;
  absorbJson(data, usage);
}

function absorbJson(text: string, usage: ParsedUsage) {
  try {
    visit(JSON.parse(text) as unknown, usage);
  } catch {
    /* not a usage payload */
  }
}

function visit(node: unknown, usage: ParsedUsage) {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (typeof record.model === "string") usage.model = record.model;
  absorbTokenFields(record, usage);
  if (record.usage && typeof record.usage === "object") absorbTokenFields(record.usage, usage);
  if (record.message && typeof record.message === "object") visit(record.message, usage);
}

function absorbTokenFields(node: unknown, usage: ParsedUsage) {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const input = num(record.input_tokens) ?? num(record.inputTokens) ?? num(record.prompt_tokens);
  const output = num(record.output_tokens) ?? num(record.outputTokens) ?? num(record.completion_tokens);
  const cache = num(record.cache_read_input_tokens) ?? num(record.cacheRead) ?? num(record.cache_read_tokens);
  const micros = num(record.cost_micros) ?? num(record.costMicros);
  const cost = num(record.cost);
  if (input == null && output == null && cache == null && micros == null && cost == null) return;
  usage.seen = true;
  if (input != null) usage.inputTokens = input;
  if (output != null) usage.outputTokens = output;
  if (cache != null) usage.cacheReadTokens = cache;
  if (micros != null) usage.costMicros = micros;
  else if (cost != null) usage.costMicros = Math.round(cost * 1_000_000);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
