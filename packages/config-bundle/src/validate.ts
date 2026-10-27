import { ManifestSchema, type Manifest, type SecretRef } from "@agenthub/domain";
import { normalizeSkillFilePath } from "./paths.js";
import { isSecretRef } from "./secrets.js";

export type ValidationError = { path: string; message: string };

const DEFAULT_COMMANDS = ["npx", "node", "uvx", "docker", "python", "python3"];

function push(errors: ValidationError[], path: string, message: string) {
  errors.push({ path, message });
}

function collectSecrets(value: unknown, out: SecretRef[]) {
  if (isSecretRef(value)) {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSecrets(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectSecrets(child, out);
    }
  }
}

export function validateManifest(
  input: unknown,
  options: {
    commandWhitelist?: string[];
    secretResolvable?: (ref: SecretRef) => boolean;
  } = {},
): { ok: boolean; errors: ValidationError[]; manifest?: Manifest } {
  const parsed = ManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  const manifest = parsed.data;
  const errors: ValidationError[] = [];
  const whitelist = options.commandWhitelist?.length
    ? options.commandWhitelist
    : DEFAULT_COMMANDS;

  const seen = (kind: string, names: string[]) => {
    const bag = new Set<string>();
    for (const name of names) {
      if (bag.has(name)) push(errors, kind, `duplicate name ${name}`);
      bag.add(name);
    }
  };
  seen("agents", manifest.agents.map((item) => item.name));
  seen("mcp", manifest.mcp.map((item) => item.name));
  seen("skills", manifest.skills.map((item) => item.name));

  manifest.mcp.forEach((item, index) => {
    if (item.transport === "local" && item.command) {
      const bin = item.command[0] ?? "";
      if (bin.includes("/") || bin.includes("\\") || /[;&|$`<>]/.test(bin)) {
        push(errors, `mcp.${index}.command`, "MCP command must be a bare allowlisted name");
      } else if (!whitelist.includes(bin)) {
        push(errors, `mcp.${index}.command`, `command ${bin} is not in the tenant whitelist`);
      }
      if (item.command.some((part) => part.includes(".."))) {
        push(errors, `mcp.${index}.command`, "MCP command must not contain ..");
      }
    }
    const secrets: SecretRef[] = [];
    collectSecrets(item.env, secrets);
    collectSecrets(item.headers, secrets);
    for (const ref of secrets) {
      if (options.secretResolvable && !options.secretResolvable(ref)) {
        push(
          errors,
          `mcp.${index}`,
          `secret ${ref.$secret.kind}:${ref.$secret.id} is not resolvable`,
        );
      }
    }
  });

  manifest.skills.forEach((skill, index) => {
    let hasSkillMd = false;
    for (const entry of skill.files) {
      try {
        const path = normalizeSkillFilePath(entry.path);
        if (path === "SKILL.md") hasSkillMd = true;
      } catch (err) {
        push(
          errors,
          `skills.${index}.files`,
          err instanceof Error ? err.message : "unsafe skill path",
        );
      }
    }
    if (!hasSkillMd) push(errors, `skills.${index}`, "skill must include SKILL.md");
  });

  return errors.length === 0 ? { ok: true, errors, manifest } : { ok: false, errors };
}
