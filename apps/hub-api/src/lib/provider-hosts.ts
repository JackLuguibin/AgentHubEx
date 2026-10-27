import { AppError } from "../errors.js";

/** `*.corp.local` matches `a.corp.local`, not `corp.local`. */
export function hostMatchesAllowlist(hostname: string, patterns: string[]): boolean {
  const host = hostname.toLowerCase();
  return patterns.some((pattern) => {
    const rule = pattern.trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === rule;
  });
}

export function assertProviderHostAllowed(
  baseUrl: string | undefined,
  patterns: string[] | undefined,
) {
  if (!baseUrl || !patterns || patterns.length === 0) return;
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    throw new AppError(400, "VALIDATION_FAILED", "Provider baseUrl is not a valid URL");
  }
  if (!hostMatchesAllowlist(hostname, patterns)) {
    throw new AppError(
      400,
      "VALIDATION_FAILED",
      `Provider host ${hostname} is not in allowedProviderHosts`,
    );
  }
}

export function allowedHostsOf(settings: unknown): string[] | undefined {
  if (!settings || typeof settings !== "object") return undefined;
  const value = (settings as { allowedProviderHosts?: unknown }).allowedProviderHosts;
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}
