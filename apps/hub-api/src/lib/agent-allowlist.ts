/**
 * Browser → Hub `/v1/workspaces/{w}/agent/*` → upstream OpenCode path policy (04 §4.3).
 * The path argument is the upstream path (after `/agent/`), e.g. `/file`, `/session`.
 */
export type AgentUpstreamDecision = "allow" | "block" | "pty" | "file-write";

const COMMON_SEGMENT = /(^|\/)project-common(\/|$)/;

export function classifyAgentUpstreamPath(
  method: string,
  upstreamPath: string,
): AgentUpstreamDecision {
  const m = method.toUpperCase();
  const path = upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`;
  const bare = path.split("?")[0] ?? path;
  if (bare.split("/").includes("..")) return "block";

  if (bare === "/session" || bare.startsWith("/session/")) return "block";
  if (bare === "/event" || bare.startsWith("/event/")) return "block";
  if (bare === "/auth" || bare.startsWith("/auth/")) return "block";
  if (bare === "/global" || bare.startsWith("/global/")) return "block";
  if (bare === "/project" || bare.startsWith("/project/")) return "block";
  if (m === "POST" && (bare === "/mcp" || bare.startsWith("/mcp/"))) return "block";
  if (m === "PATCH" && (bare === "/config" || bare.startsWith("/config/"))) return "block";

  if (m === "GET" && (bare === "/file" || bare.startsWith("/file/"))) return "allow";
  if (m === "GET" && (bare === "/find" || bare.startsWith("/find/"))) return "allow";
  if (m === "GET" && (bare === "/agent" || bare.startsWith("/agent/"))) return "allow";
  if (m === "GET" && (bare === "/mcp" || bare.startsWith("/mcp/"))) return "allow";
  if (m === "GET" && (bare === "/config" || bare.startsWith("/config/"))) return "allow";

  if (m === "PUT" && bare === "/file/content") return "file-write";
  if (
    (bare === "/pty" || bare.startsWith("/pty/")) &&
    (m === "GET" || m === "POST" || m === "PUT" || m === "DELETE")
  ) {
    return "pty";
  }

  return "block";
}

/** Personal text edits only. Shared and reserved prefixes stay read-only. */
export function personalFileWriteAllowed(filePath: string) {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 1024) return false;
  if (filePath.includes("\0") || filePath.includes("\\")) return false;
  const path = filePath.startsWith("/") ? filePath : `/${filePath}`;
  if (path === "/" || path.endsWith("/")) return false;
  const parts = path.split("/").slice(1);
  if (parts.length === 0 || parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    return false;
  }
  if (COMMON_SEGMENT.test(path)) return false;
  if (parts.includes(".agenthub")) return false;
  return true;
}

/** Missing either gate hides the terminal and makes `/pty` return 501. */
export function ptyGateOpen(capabilities: { pty?: boolean } | null | undefined, tenantSettings: unknown) {
  return capabilities?.pty === true && tenantAllowsPty(tenantSettings);
}

export function tenantAllowsPty(settings: unknown) {
  if (!settings || typeof settings !== "object") return true;
  return (settings as { ptyEnabled?: unknown }).ptyEnabled !== false;
}
