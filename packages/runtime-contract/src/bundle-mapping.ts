/** Path mapping from docs/architecture/07-config-bundle.md §7.1 and §7.5. */

export const MANAGED_MANIFEST_PATH = ".agenthub/managed.json";

export const OPENCODE_PATHS = {
  config: "opencode.json",
  agentsMd: "AGENTS.md",
  agent(name: string) {
    return `.opencode/agents/${name}.md`;
  },
  skill(name: string, file: string) {
    return `.opencode/skills/${name}/${file}`;
  },
} as const;

export const CLAUDE_PATHS = {
  agentsMd: "CLAUDE.md",
  skill(name: string, file: string) {
    return `.claude/skills/${name}/${file}`;
  },
} as const;

export function isAllowedManagedPath(filePath: string): boolean {
  const path = filePath.replace(/\\/g, "/");
  if (
    path === "opencode.json" ||
    path === "AGENTS.md" ||
    path === "CLAUDE.md" ||
    path === MANAGED_MANIFEST_PATH
  ) {
    return true;
  }
  const fileOk = (prefix: string) =>
    path.startsWith(prefix) && path.length > prefix.length && !path.endsWith("/");
  return (
    fileOk(".opencode/") || fileOk(".claude/") || fileOk("project-common/")
  );
}
