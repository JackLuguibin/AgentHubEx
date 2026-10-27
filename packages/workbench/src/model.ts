import type { Envelope } from "@agenthub/runtime-contract";

export type ChatRole = "user" | "assistant" | "system" | "tool";

export type ChatLine = {
  id: string;
  role: ChatRole;
  text: string;
  toolName?: string;
  toolInput?: unknown;
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

export type EditorMode = "code" | "diff" | "info";

export type EditorTab = {
  path: string;
  original: string;
  draft: string;
  zone: "personal" | "common";
  editable: boolean;
};

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

export function canEditFile(zone: "personal" | "common", text: string | null) {
  return zone === "personal" && text !== null;
}

export function tabDirty(tab: EditorTab) {
  return tab.draft !== tab.original;
}

export function upsertEditorTab(tabs: EditorTab[], next: EditorTab): EditorTab[] {
  const existing = tabs.find((tab) => tab.path === next.path);
  if (!existing) return [...tabs, next];
  if (existing.draft !== existing.original) {
    return tabs.map((tab) =>
      tab.path === next.path
        ? { ...existing, original: next.original, zone: next.zone, editable: next.editable }
        : tab,
    );
  }
  return tabs.map((tab) => (tab.path === next.path ? next : tab));
}

export function closeEditorTab(tabs: EditorTab[], path: string, active: string | null) {
  const next = tabs.filter((tab) => tab.path !== path);
  const nextActive = active === path ? (next.at(-1)?.path ?? null) : active;
  return { tabs: next, active: nextActive };
}

export function lineDiff(before: string, after: string): DiffLine[] {
  const left = before.split("\n");
  const right = after.split("\n");
  if (left.length * right.length > 250_000) {
    return [
      { kind: "del", text: "文件较大，差异只保留整段替换" },
      { kind: "add", text: `${right.length} 行` },
    ];
  }
  const scores: number[][] = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      scores[i]![j] =
        left[i] === right[j] ? scores[i + 1]![j + 1]! + 1 : Math.max(scores[i + 1]![j]!, scores[i]![j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      lines.push({ kind: "same", text: left[i]! });
      i += 1;
      j += 1;
    } else if (scores[i + 1]![j]! >= scores[i]![j + 1]!) {
      lines.push({ kind: "del", text: left[i]! });
      i += 1;
    } else {
      lines.push({ kind: "add", text: right[j]! });
      j += 1;
    }
  }
  while (i < left.length) lines.push({ kind: "del", text: left[i++]! });
  while (j < right.length) lines.push({ kind: "add", text: right[j++]! });
  return lines;
}

export function agentFileContentRequest(path: string) {
  return `file/content?path=${encodeURIComponent(path)}`;
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
      lines: upsertTool(lines, data.toolId, data.name, formatUnknown(data.input), true, false, data.input),
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

const CHANGE_NAME = /edit|write|patch|apply|create|delete|str_replace|multiedit/i;
const SKIP_NAME = /^(read|grep|glob|find|list|ls|bash|shell|webfetch|websearch)$/i;

export function pathFromToolInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const raw = record.path ?? record.filePath ?? record.file_path;
  if (typeof raw !== "string" || !raw.trim() || raw.includes("\n")) return null;
  const path = raw.trim();
  return path.startsWith("/") ? path : `/${path}`;
}

export function countsAsSessionChange(name: string, input: unknown) {
  if (SKIP_NAME.test(name)) return false;
  if (CHANGE_NAME.test(name)) return pathFromToolInput(input) != null;
  if (!input || typeof input !== "object") return false;
  const record = input as Record<string, unknown>;
  const hasBody =
    "oldString" in record ||
    "newString" in record ||
    "old_string" in record ||
    "new_string" in record ||
    "content" in record ||
    "contents" in record;
  return hasBody && pathFromToolInput(input) != null;
}

export function sessionChangedPaths(lines: ChatLine[], tabs: EditorTab[]) {
  const paths: string[] = [];
  for (const line of lines) {
    if (line.role !== "tool" || !line.toolName || !countsAsSessionChange(line.toolName, line.toolInput)) continue;
    const path = pathFromToolInput(line.toolInput);
    if (path) paths.push(path);
  }
  for (const tab of tabs) {
    if (tab.draft !== tab.original) paths.push(tab.path);
  }
  return [...new Set(paths)];
}

export function toolPresentation(line: ChatLine): { summary: string; diff: DiffLine[] | null; output: string } {
  const record = line.toolInput && typeof line.toolInput === "object" ? (line.toolInput as Record<string, unknown>) : null;
  const command = stringField(record, "command") ?? stringField(record, "cmd");
  const path = pathFromToolInput(line.toolInput);
  const oldText = stringField(record, "oldString") ?? stringField(record, "old_string");
  const newText = stringField(record, "newString") ?? stringField(record, "new_string");
  const diff =
    oldText != null && newText != null
      ? lineDiff(oldText, newText)
          .filter((item) => item.kind !== "same")
          .slice(0, 80)
      : null;
  return {
    summary: command ?? path ?? (line.toolPending ? line.text : ""),
    diff,
    output: line.toolPending ? "" : line.text,
  };
}

function stringField(record: Record<string, unknown> | null, key: string) {
  if (!record) return null;
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function upsertTool(
  lines: ChatLine[],
  id: string,
  name: string,
  text: string,
  pending: boolean,
  isError: boolean,
  input?: unknown,
): ChatLine[] {
  const idx = lines.findIndex((line) => line.id === id);
  const previous = idx === -1 ? undefined : lines[idx];
  const next: ChatLine = {
    id,
    role: "tool",
    text,
    toolName: name || previous?.toolName,
    toolInput: input !== undefined ? input : previous?.toolInput,
    toolPending: pending,
    toolError: isError,
  };
  if (idx === -1) return [...lines, next];
  const copy = [...lines];
  copy[idx] = next;
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
