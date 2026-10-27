import type { Envelope } from "@agenthub/runtime-contract";

export type ChatRole = "user" | "assistant" | "system" | "tool";

export type ChatLine = {
  id: string;
  role: ChatRole;
  text: string;
  toolName?: string;
  toolPending?: boolean;
  toolError?: boolean;
};

export type PermissionAsk = {
  reqId: string;
  tool: string;
  input: unknown;
  options: Array<"allow" | "deny" | "always">;
};

export type ApplyResult = {
  lines: ChatLine[];
  sessionStatus?: "busy" | "idle" | "failed";
  permission?: PermissionAsk | null;
  staleCursor?: boolean;
};

export type AgentFileNode = {
  name: string;
  path: string;
  kind: "file" | "directory";
  zone: "personal" | "common";
};

export type NormalizedAgentFile =
  | { kind: "directory"; entries: AgentFileNode[] }
  | { kind: "file"; path: string; text: string | null; zone: "personal" | "common" };

const COMMON_SEGMENT = /(^|\/)project-common(\/|$)/;

export function isCommonPath(path: string) {
  return COMMON_SEGMENT.test(path.replace(/\\/g, "/"));
}

export function zoneOf(path: string): "personal" | "common" {
  return isCommonPath(path) ? "common" : "personal";
}

export function joinAgentPath(parent: string, name: string) {
  if (name.startsWith("/")) return name;
  const base = parent === "/" ? "" : parent.replace(/\/$/, "");
  return `${base}/${name}`;
}

export function parentAgentPath(path: string) {
  if (path === "/" || path === "") return "/";
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

export function credentialSwitchLocked(statuses: string[]) {
  return statuses.includes("busy");
}

export function showsFiles(capabilities: { files?: boolean } | null | undefined) {
  return capabilities?.files === true;
}

export function showsFind(capabilities: { find?: boolean } | null | undefined) {
  return capabilities?.find === true;
}

export function showsTerminal(capabilities: { pty?: boolean } | null | undefined) {
  return capabilities?.pty === true;
}

export function showsPermissions(capabilities: { permissions?: boolean } | null | undefined) {
  return capabilities?.permissions === true;
}

export function showsAbort(capabilities: { abort?: boolean } | null | undefined) {
  return capabilities?.abort === true;
}

/** Browser file/find reads. Session and event paths stay on the Facade. */
export function agentFileRequest(path: string) {
  return `file?path=${encodeURIComponent(path)}`;
}

export function agentFindRequest(query: string) {
  return `find?q=${encodeURIComponent(query)}`;
}

export function browserMustNotCallAgent(method: string, upstreamPath: string) {
  const verb = method.toUpperCase();
  const bare = (upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`).split("?")[0] ?? "";
  if (bare === "/session" || bare.startsWith("/session/")) return true;
  if (bare === "/event" || bare.startsWith("/event/")) return true;
  if (bare === "/auth" || bare.startsWith("/auth/")) return true;
  if (verb === "PATCH" && (bare === "/config" || bare.startsWith("/config/"))) return true;
  if (verb === "PUT" && (bare === "/auth" || bare.startsWith("/auth/"))) return true;
  return false;
}

export function credentialKey(source: string, id: string) {
  return `${source}:${id}`;
}

export function parseCredentialKey(key: string): { source: "user" | "project"; id: string } | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const source = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if ((source !== "user" && source !== "project") || !id) return null;
  return { source, id };
}

export function extractText(parts: unknown[]) {
  return parts
    .map((part) => {
      if (part && typeof part === "object" && "type" in part && (part as { type: string }).type === "text") {
        return String((part as { text?: string }).text ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function applyEnvelope(
  envelope: Envelope,
  lines: ChatLine[],
  buf: Map<string, string>,
): ApplyResult {
  if (envelope.type === "session.status") {
    const status = (envelope.data as { status?: string }).status;
    const sessionStatus =
      status === "busy" || status === "idle" ? status : status === "error" ? "failed" : undefined;
    return sessionStatus ? { lines, sessionStatus } : { lines };
  }

  if (envelope.type === "assistant.delta") {
    const { messageId, text } = envelope.data as { messageId: string; text: string };
    const next = (buf.get(messageId) ?? "") + text;
    buf.set(messageId, next);
    return { lines: upsertText(lines, messageId, "assistant", next) };
  }

  if (envelope.type === "assistant.message" || envelope.type === "message.start") {
    const data = envelope.data as { messageId: string; text?: string };
    const text = data.text ?? buf.get(data.messageId) ?? "";
    if (envelope.type === "assistant.message") buf.set(data.messageId, text);
    return { lines: upsertText(lines, data.messageId, "assistant", text) };
  }

  if (envelope.type === "tool_call") {
    const data = envelope.data as { toolId: string; name: string; input: unknown };
    return {
      lines: upsertTool(lines, data.toolId, data.name, formatUnknown(data.input), true, false),
    };
  }

  if (envelope.type === "tool_result") {
    const data = envelope.data as { toolId: string; output: unknown; isError: boolean };
    const existing = lines.find((line) => line.id === data.toolId);
    return {
      lines: upsertTool(
        lines,
        data.toolId,
        existing?.toolName ?? "tool",
        formatUnknown(data.output),
        false,
        data.isError,
      ),
    };
  }

  if (envelope.type === "permission_request") {
    const data = envelope.data as PermissionAsk;
    return { lines, permission: data };
  }

  if (envelope.type === "permission_resolved") {
    const data = envelope.data as { reqId: string; decision: string };
    return {
      lines: upsertText(
        lines,
        `perm-${data.reqId}`,
        "system",
        `权限已${decisionLabel(data.decision)}`,
      ),
      permission: null,
    };
  }

  if (envelope.type === "error") {
    const data = envelope.data as { code: string; message: string };
    return {
      lines: [
        ...lines,
        { id: `err-${envelope.seq}`, role: "system", text: `${data.code}: ${data.message}` },
      ],
      staleCursor: data.code === "SSE_CURSOR_STALE",
    };
  }

  return { lines };
}

export function normalizeAgentFile(body: unknown, requestedPath: string): NormalizedAgentFile {
  if (Array.isArray(body)) {
    return { kind: "directory", entries: body.map((item) => entryFromUnknown(item, requestedPath)) };
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.entries) || record.type === "directory") {
      const entries = Array.isArray(record.entries) ? record.entries : [];
      return {
        kind: "directory",
        entries: entries.map((item) => entryFromUnknown(item, requestedPath)),
      };
    }
    if (Array.isArray(record.matches)) {
      return {
        kind: "directory",
        entries: record.matches.map((item) => entryFromUnknown(item, "/")),
      };
    }
    if ("content" in record || record.type === "file") {
      const text = typeof record.content === "string" ? record.content : null;
      const path = typeof record.path === "string" ? record.path : requestedPath;
      return { kind: "file", path, text, zone: zoneOf(path) };
    }
  }
  return { kind: "file", path: requestedPath, text: null, zone: zoneOf(requestedPath) };
}

function entryFromUnknown(item: unknown, parent: string): AgentFileNode {
  const record = (item ?? {}) as { name?: string; path?: string; type?: string };
  const name = record.name || record.path?.split("/").filter(Boolean).pop() || "file";
  const path = record.path?.startsWith("/") ? record.path : joinAgentPath(parent, name);
  const kind = record.type === "directory" || record.type === "dir" ? "directory" : "file";
  return { name, path, kind, zone: zoneOf(path) };
}

function upsertText(lines: ChatLine[], id: string, role: ChatRole, text: string): ChatLine[] {
  const idx = lines.findIndex((line) => line.id === id);
  if (idx === -1) return [...lines, { id, role, text }];
  const copy = [...lines];
  copy[idx] = { ...copy[idx]!, id, role, text };
  return copy;
}

function upsertTool(
  lines: ChatLine[],
  id: string,
  name: string,
  text: string,
  pending: boolean,
  isError: boolean,
): ChatLine[] {
  const idx = lines.findIndex((line) => line.id === id);
  const next: ChatLine = {
    id,
    role: "tool",
    text,
    toolName: name,
    toolPending: pending,
    toolError: isError,
  };
  if (idx === -1) return [...lines, next];
  const copy = [...lines];
  copy[idx] = { ...copy[idx]!, ...next, toolName: name || copy[idx]!.toolName };
  return copy;
}

function formatUnknown(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function decisionLabel(decision: string) {
  if (decision === "allow") return "允许";
  if (decision === "deny") return "拒绝";
  if (decision === "always") return "始终允许";
  if (decision === "timeout") return "超时拒绝";
  return decision;
}
