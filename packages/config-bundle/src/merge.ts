import {
  ManifestSchema,
  type AgentDef,
  type ConfigLock,
  type Manifest,
  type McpDef,
  type SkillRef,
} from "@agenthub/domain";
import { contentHash } from "./hash.js";

export type MergeScope = "platform" | "tenant" | "project" | "user" | "session";

export type MergeLayer = {
  scope: MergeScope;
  manifest: Manifest;
};

const RULES = new Set(["allow", "ask", "deny"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mergePermission(
  base: Record<string, unknown> | undefined,
  overlay: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!overlay) return base;
  if (!base) return overlay;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const prev = out[key];
    if (prev === "deny" || value === "deny") {
      out[key] = "deny";
      continue;
    }
    if (isRecord(prev) && isRecord(value)) {
      out[key] = mergePermission(prev, value);
      continue;
    }
    if (typeof value === "string" && !RULES.has(value) && !isRecord(value)) {
      out[key] = value;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function byName<T extends { name: string }>(items: Iterable<T>): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function cloneMap<T>(map: Map<string, T>): Map<string, T> {
  return new Map([...map.entries()].map(([key, value]) => [key, structuredClone(value)]));
}

/**
 * Platform → tenant → project → user → session.
 * Same-name agents, skills, and MCP replace earlier layers.
 * AGENTS.md is concatenated. Permission deep-merges and deny wins.
 * User layers only keep whitelist categories and cannot change forced agents or MCP.
 */
export function mergeConfig(input: {
  layers: MergeLayer[];
  lock: ConfigLock;
  role?: "owner" | "developer" | "viewer";
}): { manifest: Manifest; sources: Record<string, string>; hash: string } {
  const agents = new Map<string, AgentDef>();
  const mcp = new Map<string, McpDef>();
  const skills = new Map<string, SkillRef>();
  const sources: Record<string, string> = {};
  let agentsMd: string | undefined;
  const agentsMdSources: string[] = [];
  const extra: string[] = [];
  let permission: Record<string, unknown> | undefined;
  let model: string | undefined;
  let includeCommonAgentsMd: boolean | undefined;

  let projectAgents = new Map<string, AgentDef>();
  let projectMcp = new Map<string, McpDef>();
  let projectSources: Record<string, string> = {};
  let snapshotted = false;

  for (const raw of input.layers) {
    const manifest = ManifestSchema.parse(raw.manifest);
    const userish = raw.scope === "user" || raw.scope === "session";
    if (userish && !input.lock.allowUserOverlay) continue;
    if (userish && !snapshotted) {
      projectAgents = cloneMap(agents);
      projectMcp = cloneMap(mcp);
      projectSources = { ...sources };
      snapshotted = true;
    }

    const allow = (category: "skills" | "agents") =>
      !userish || input.lock.userOverlayWhitelist.includes(category);

    if (allow("agents")) {
      for (const agent of manifest.agents) {
        if (userish && input.lock.forcedAgents.includes(agent.name)) continue;
        agents.set(agent.name, agent);
        sources[`agent:${agent.name}`] = raw.scope;
      }
    }

    if (!userish) {
      for (const item of manifest.mcp) {
        mcp.set(item.name, item);
        sources[`mcp:${item.name}`] = raw.scope;
      }
    }

    if (allow("skills")) {
      for (const skill of manifest.skills) {
        skills.set(skill.name, skill);
        sources[`skill:${skill.name}`] = raw.scope;
      }
    }

    if (!userish) {
      if (manifest.instructions.agentsMd) {
        agentsMd = agentsMd
          ? `${agentsMd}\n\n## ${raw.scope}\n\n${manifest.instructions.agentsMd}`
          : manifest.instructions.agentsMd;
        agentsMdSources.push(raw.scope);
      }
      for (const item of manifest.instructions.extra ?? []) {
        if (!extra.includes(item)) extra.push(item);
      }
      if (manifest.permission) {
        permission = mergePermission(permission, manifest.permission);
        sources.permission = sources.permission
          ? `${sources.permission}+${raw.scope}`
          : raw.scope;
      }
      if (manifest.model) {
        model = manifest.model;
        sources.model = raw.scope;
      }
      if (manifest.includeCommonAgentsMd !== undefined) {
        includeCommonAgentsMd = manifest.includeCommonAgentsMd;
      }
    }
  }

  if (snapshotted) {
    for (const name of input.lock.forcedAgents) {
      const forced = projectAgents.get(name);
      if (!forced) continue;
      agents.set(name, forced);
      const source = projectSources[`agent:${name}`];
      if (source) sources[`agent:${name}`] = source;
    }
    if (input.lock.lockMcp) {
      for (const name of [...mcp.keys()]) {
        if (!projectMcp.has(name)) {
          mcp.delete(name);
          delete sources[`mcp:${name}`];
        }
      }
      for (const [name, item] of projectMcp) {
        mcp.set(name, item);
        const source = projectSources[`mcp:${name}`];
        if (source) sources[`mcp:${name}`] = source;
      }
    }
  }

  if (input.role) {
    for (const [name, item] of [...mcp]) {
      if (item.roles && item.roles.length > 0 && !item.roles.includes(input.role)) {
        mcp.delete(name);
        delete sources[`mcp:${name}`];
      }
    }
  }

  if (agentsMdSources.length > 0) {
    sources["instructions.agentsMd"] = agentsMdSources.join("+");
  }

  const instructions: Manifest["instructions"] = {};
  if (agentsMd) instructions.agentsMd = agentsMd;
  if (extra.length > 0) instructions.extra = extra;

  const merged = ManifestSchema.parse({
    agents: byName(agents.values()),
    mcp: byName(mcp.values()),
    skills: byName(skills.values()),
    instructions,
    ...(permission ? { permission } : {}),
    ...(model ? { model } : {}),
    ...(includeCommonAgentsMd !== undefined ? { includeCommonAgentsMd } : {}),
  });

  return { manifest: merged, sources, hash: contentHash(merged) };
}
