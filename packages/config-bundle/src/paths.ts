import { isAllowedManagedPath } from "@agenthub/runtime-contract";

export function normalizeManagedPath(input: string): string {
  const path = input.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`unsafe path: ${input}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`unsafe path: ${input}`);
  }
  if (!isAllowedManagedPath(path)) {
    throw new Error(`path not managed: ${input}`);
  }
  return path;
}

/** Skill archive paths are relative to the skill directory, before workspace prefixing. */
export function normalizeSkillFilePath(input: string): string {
  const path = input.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`unsafe skill path: ${input}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`unsafe skill path: ${input}`);
  }
  return path;
}
