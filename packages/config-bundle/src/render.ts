import { withCommonWriteDeny } from "@agenthub/common-fs";
import type { Manifest, SecretRef } from "@agenthub/domain";
import { CLAUDE_PATHS, OPENCODE_PATHS } from "@agenthub/runtime-contract";
import { sha256Buffer } from "./hash.js";
import { normalizeSkillFilePath } from "./paths.js";
import { isSecretRef, secretPlaceholder } from "./secrets.js";

export type ApiOp =
  | { op: "mcp.add"; name: string; config: Record<string, unknown> }
  | { op: "config.patch"; path: string; value: unknown };

export type RenderedFile = {
  path: string;
  content: Buffer;
  sha256: string;
};

export type RenderedTree = {
  files: RenderedFile[];
  apiOps: ApiOp[];
  manifest: Record<string, string>;
};

function file(path: string, text: string): RenderedFile {
  const content = Buffer.from(text, "utf8");
  return { path, content, sha256: sha256Buffer(content) };
}

function envForFile(
  env: Record<string, string | SecretRef> | undefined,
): Record<string, string> | undefined {
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = isSecretRef(value) ? secretPlaceholder(value) : value;
  }
  return out;
}

function agentMarkdown(agent: Manifest["agents"][number]): string {
  const lines = ["---", `description: ${JSON.stringify(agent.description)}`];
  if (agent.mode) lines.push(`mode: ${agent.mode}`);
  if (agent.model) lines.push(`model: ${JSON.stringify(agent.model)}`);
  lines.push("---", "", agent.prompt, "");
  return lines.join("\n");
}

function skillFiles(
  manifest: Manifest,
  blobs: Record<string, Buffer>,
  mapPath: (skill: string, filePath: string) => string,
): RenderedFile[] {
  const files: RenderedFile[] = [];
  for (const skill of manifest.skills) {
    for (const entry of skill.files) {
      const rel = normalizeSkillFilePath(entry.path);
      const bytes = blobs[entry.sha256];
      if (!bytes) throw new Error(`missing blob ${entry.sha256}`);
      files.push({
        path: mapPath(skill.name, rel),
        content: bytes,
        sha256: sha256Buffer(bytes),
      });
    }
  }
  return files;
}

function mcpApi(manifest: Manifest): ApiOp[] {
  return manifest.mcp
    .filter((item) => item.enabled)
    .map((item) => ({
      op: "mcp.add" as const,
      name: item.name,
      config: {
        type: item.transport,
        ...(item.command ? { command: item.command } : {}),
        ...(item.url ? { url: item.url } : {}),
        ...(item.env ? { env: item.env } : {}),
        ...(item.headers ? { headers: item.headers } : {}),
        enabled: item.enabled,
      },
    }));
}

function renderOpencode(manifest: Manifest, existingConfig: string | null): RenderedFile {
  let base: Record<string, unknown> = {};
  if (existingConfig) {
    try {
      const parsed = JSON.parse(existingConfig) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      base = {};
    }
  }

  const agent: Record<string, unknown> = {};
  for (const item of manifest.agents) {
    agent[item.name] = {
      description: item.description,
      ...(item.mode ? { mode: item.mode } : {}),
      ...(item.model ? { model: item.model } : {}),
      prompt: item.prompt,
    };
  }

  const mcp: Record<string, unknown> = {};
  for (const item of manifest.mcp) {
    mcp[item.name] = {
      type: item.transport,
      ...(item.command ? { command: item.command } : {}),
      ...(item.url ? { url: item.url } : {}),
      ...(item.env ? { env: envForFile(item.env) } : {}),
      ...(item.headers ? { headers: envForFile(item.headers) } : {}),
      enabled: item.enabled,
    };
  }

  const instructions: string[] = [OPENCODE_PATHS.agentsMd];
  if (manifest.includeCommonAgentsMd) instructions.push("project-common/AGENTS.md");
  for (const extra of manifest.instructions.extra ?? []) instructions.push(extra);

  const next: Record<string, unknown> = { ...base };
  next.agent = agent;
  next.mcp = mcp;
  next.instructions = instructions;
  next.permission = withCommonWriteDeny(manifest.permission as Record<string, unknown> | undefined);
  if (manifest.model) next.model = manifest.model;
  else delete next.model;
  next.agenthub = { managed: true };
  return file(OPENCODE_PATHS.config, `${JSON.stringify(next, null, 2)}\n`);
}

const MANAGED_OPENCODE_KEYS = ["agent", "mcp", "instructions", "permission", "model", "agenthub"] as const;

/** Keep user keys in an existing opencode.json and replace only the Hub-managed section. */
export function mergeRenderedOpencode(existing: string, rendered: string): string {
  const read = (text: string) => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  };
  const base = read(existing);
  const incoming = read(rendered);
  const next: Record<string, unknown> = { ...base };
  for (const key of MANAGED_OPENCODE_KEYS) {
    if (key in incoming) next[key] = incoming[key];
    else delete next[key];
  }
  return `${JSON.stringify(next, null, 2)}\n`;
}

export function renderBundle(input: {
  manifest: Manifest;
  runtimeType: "opencode" | "claude";
  blobs: Record<string, Buffer>;
  existingFiles?: Record<string, string>;
}): RenderedTree {
  const { manifest } = input;
  const agentsMd = manifest.instructions.agentsMd ?? "";
  const files: RenderedFile[] = [];
  const apiOps: ApiOp[] = [...mcpApi(manifest)];

  if (input.runtimeType === "opencode") {
    files.push(renderOpencode(manifest, input.existingFiles?.[OPENCODE_PATHS.config] ?? null));
    files.push(file(OPENCODE_PATHS.agentsMd, agentsMd ? `${agentsMd}\n` : ""));
    for (const agent of manifest.agents) {
      files.push(file(OPENCODE_PATHS.agent(agent.name), agentMarkdown(agent)));
    }
    files.push(...skillFiles(manifest, input.blobs, OPENCODE_PATHS.skill));
    if (manifest.model) {
      apiOps.push({ op: "config.patch", path: "model", value: manifest.model });
    }
  } else {
    files.push(file(CLAUDE_PATHS.agentsMd, agentsMd ? `${agentsMd}\n` : ""));
    files.push(...skillFiles(manifest, input.blobs, CLAUDE_PATHS.skill));
    apiOps.push({
      op: "config.patch",
      path: "agents",
      value: manifest.agents.map((agent) => ({
        name: agent.name,
        description: agent.description,
        prompt: agent.prompt,
        ...(agent.model ? { model: agent.model } : {}),
      })),
    });
    if (manifest.model) {
      apiOps.push({ op: "config.patch", path: "model", value: manifest.model });
    }
  }

  const treeManifest: Record<string, string> = {};
  for (const item of files) treeManifest[item.path] = item.sha256;
  return { files, apiOps, manifest: treeManifest };
}
