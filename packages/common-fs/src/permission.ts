/** OpenCode/Claude file edits under the synced tree are denied by default (A4). */
export const COMMON_WRITE_DENY_GLOB = "project-common/**";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function withCommonWriteDeny(
  permission: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(permission ?? {}) };
  for (const key of ["edit", "write"] as const) {
    const current = next[key];
    if (current === "deny") continue;
    if (isRecord(current)) {
      next[key] = { ...current, [COMMON_WRITE_DENY_GLOB]: "deny" };
      continue;
    }
    next[key] = {
      ...(typeof current === "string" ? { "*": current } : {}),
      [COMMON_WRITE_DENY_GLOB]: "deny",
    };
  }
  return next;
}
