/** Path and option mapping from docs/architecture/07-config-bundle.md and 11.7. */

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

/** Effective bundle field → Claude Agent SDK option. The worker consumes this table. */
export const CLAUDE_BUNDLE_OPTION_MAP = [
  { effective: "model", option: "model" },
  {
    effective: "instructions.agentsMd",
    option: "CLAUDE.md + systemPrompt.append",
    note: "settingSources includes project",
  },
  { effective: "agents", option: "agents" },
  { effective: "mcp.local", option: "mcpServers stdio" },
  { effective: "mcp.remote", option: "mcpServers http|sse" },
  { effective: "skills", option: "skillFiles under .claude/skills" },
  {
    effective: "permission",
    option: "allowedTools + disallowedTools + permissionMode",
    note: "path-level rules stay on PermissionBridge",
  },
  { effective: "cwd", option: "cwd", note: "default /workspace" },
] as const;

export type BundleMapAgent = {
  name: string;
  description: string;
  prompt: string;
  tools?: Record<string, boolean>;
  model?: string;
};

export type BundleMapMcp = {
  name: string;
  transport: "local" | "remote";
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
};

export type BundleMapInput = {
  model?: string;
  instructions?: { agentsMd?: string; extra?: string[] };
  agents?: BundleMapAgent[];
  mcp?: BundleMapMcp[];
  skills?: Array<{ name: string }>;
  permission?: Record<string, unknown>;
  cwd?: string;
};

export type ClaudeMcpServer =
  | { type: "stdio"; command: string; args: string[]; env?: Record<string, string> }
  | { type: "http" | "sse"; url: string; headers?: Record<string, string> };

export type ClaudePermissionRule = "allow" | "deny" | "ask";

export type ClaudeAgentOptions = {
  model?: string;
  cwd: string;
  settingSources: ["project"];
  systemPrompt?: { preset: "claude_code"; append: string };
  claudeMd: string;
  agents: Record<
    string,
    { description: string; prompt: string; tools?: string[]; model?: string }
  >;
  mcpServers: Record<string, ClaudeMcpServer>;
  allowedTools: string[];
  disallowedTools: string[];
  permissionMode: "default" | "dontAsk";
  /** Tool name → rule. Mixed path rules become ask so the bridge can still deny. */
  permissionRules: Record<string, ClaudePermissionRule>;
  skillFiles: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function leafRules(value: unknown): ClaudePermissionRule[] {
  if (value === "allow" || value === "deny" || value === "ask") return [value];
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap((item) => leafRules(item));
}

export function classifyPermission(value: unknown): ClaudePermissionRule {
  const leaves = leafRules(value);
  if (leaves.length === 0) return "ask";
  if (leaves.every((rule) => rule === "deny")) return "deny";
  if (leaves.every((rule) => rule === "allow")) return "allow";
  return "ask";
}

function claudeMdText(input: BundleMapInput): string {
  const parts = [input.instructions?.agentsMd ?? "", ...(input.instructions?.extra ?? [])]
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.join("\n\n");
}

function remoteTransport(url: string): "http" | "sse" {
  return url.includes("/sse") ? "sse" : "http";
}

export function mapBundleToClaudeOptions(input: BundleMapInput): ClaudeAgentOptions {
  const cwd = input.cwd && input.cwd.length > 0 ? input.cwd : "/workspace";
  const append = claudeMdText(input);
  const agents: ClaudeAgentOptions["agents"] = {};
  for (const agent of input.agents ?? []) {
    const tools = Object.entries(agent.tools ?? {})
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
    agents[agent.name] = {
      description: agent.description,
      prompt: agent.prompt,
      ...(tools.length > 0 ? { tools } : {}),
      ...(agent.model ? { model: agent.model } : {}),
    };
  }

  const mcpServers: ClaudeAgentOptions["mcpServers"] = {};
  for (const item of input.mcp ?? []) {
    if (item.enabled === false) continue;
    if (item.transport === "local") {
      const [command, ...args] = item.command ?? [];
      if (!command) continue;
      mcpServers[item.name] = {
        type: "stdio",
        command,
        args,
        ...(item.env ? { env: item.env } : {}),
      };
      continue;
    }
    if (!item.url) continue;
    mcpServers[item.name] = {
      type: remoteTransport(item.url),
      url: item.url,
      ...(item.headers ? { headers: item.headers } : {}),
    };
  }

  const permissionRules: Record<string, ClaudePermissionRule> = {};
  const allowedTools: string[] = [];
  const disallowedTools: string[] = [];
  for (const [tool, value] of Object.entries(input.permission ?? {})) {
    const rule = classifyPermission(value);
    permissionRules[tool] = rule;
    if (rule === "allow") allowedTools.push(tool);
    if (rule === "deny") disallowedTools.push(tool);
  }

  return {
    ...(input.model ? { model: input.model } : {}),
    cwd,
    settingSources: ["project"],
    ...(append
      ? { systemPrompt: { preset: "claude_code", append } }
      : {}),
    claudeMd: append,
    agents,
    mcpServers,
    allowedTools,
    disallowedTools,
    permissionMode: Object.values(permissionRules).includes("ask") ? "default" : "dontAsk",
    permissionRules,
    skillFiles: (input.skills ?? []).map((skill) => CLAUDE_PATHS.skill(skill.name, "SKILL.md")),
  };
}

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
  return fileOk(".opencode/") || fileOk(".claude/") || fileOk("project-common/");
}
