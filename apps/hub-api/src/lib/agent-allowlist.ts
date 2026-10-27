/**
 * Browser → Hub `/v1/workspaces/{w}/agent/*` → upstream OpenCode path policy (04 §4.3).
 * The path argument is the upstream path (after `/agent/`), e.g. `/file`, `/session`.
 */
export function classifyAgentUpstreamPath(
  method: string,
  upstreamPath: string,
): "allow" | "block" {
  const m = method.toUpperCase();
  const path = upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`;
  const bare = path.split("?")[0] ?? path;

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

  return "block";
}
