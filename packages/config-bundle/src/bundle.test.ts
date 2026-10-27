import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigLockSchema, ManifestSchema, type Manifest } from "@agenthub/domain";
import { describe, expect, it } from "vitest";
import { applyManagedTree } from "./files.js";
import { contentHash } from "./hash.js";
import { mergeConfig } from "./merge.js";
import { renderBundle } from "./render.js";
import { validateManifest } from "./validate.js";

const lock = ConfigLockSchema.parse({});

function manifest(partial: Partial<Manifest>): Manifest {
  return ManifestSchema.parse(partial);
}

describe("mergeConfig", () => {
  const platform = manifest({
    agents: [
      {
        name: "review",
        description: "Review changes",
        prompt: "platform review",
      },
    ],
    mcp: [
      {
        name: "web",
        transport: "remote",
        url: "https://search.example/mcp",
        enabled: true,
      },
    ],
    instructions: { agentsMd: "platform rules" },
    permission: { edit: "allow", bash: { rm: "deny" } },
    model: "platform-model",
  });

  const project = manifest({
    agents: [
      {
        name: "build",
        description: "Build features",
        prompt: "project build",
        mode: "primary",
      },
    ],
    mcp: [
      {
        name: "docs",
        transport: "local",
        command: ["npx", "-y", "docs-mcp"],
        enabled: true,
        roles: ["owner", "developer"],
      },
    ],
    skills: [
      {
        name: "api-conventions",
        files: [{ path: "SKILL.md", sha256: "a".repeat(64), size: 4 }],
      },
    ],
    instructions: { agentsMd: "project rules" },
    permission: { edit: "deny" },
    model: "project-model",
  });

  it("overlays project on platform and concatenates instructions", () => {
    const merged = mergeConfig({
      layers: [
        { scope: "platform", manifest: platform },
        { scope: "project", manifest: project },
      ],
      lock,
      role: "developer",
    });
    expect(merged.manifest.agents.map((item) => item.name)).toEqual(["build", "review"]);
    expect(merged.manifest.instructions.agentsMd).toContain("platform rules");
    expect(merged.manifest.instructions.agentsMd).toContain("project rules");
    expect(merged.manifest.model).toBe("project-model");
    expect(merged.manifest.permission).toMatchObject({ edit: "deny" });
    expect(merged.sources["agent:build"]).toBe("project");
    expect(merged.sources["instructions.agentsMd"]).toBe("platform+project");
    expect(merged.hash).toBe(contentHash(merged.manifest));
  });

  it("keeps an earlier deny when a later layer allows the same rule", () => {
    const later = manifest({ permission: { bash: { rm: "allow" }, edit: "allow" } });
    const merged = mergeConfig({
      layers: [
        { scope: "platform", manifest: platform },
        { scope: "project", manifest: later },
      ],
      lock,
    });
    expect(merged.manifest.permission).toMatchObject({
      edit: "allow",
      bash: { rm: "deny" },
    });
  });

  it("lets a user replace agents and skills but not MCP or forced agents", () => {
    const user = manifest({
      agents: [
        { name: "build", description: "Hacked", prompt: "hacked" },
        { name: "notes", description: "Personal notes", prompt: "notes" },
      ],
      mcp: [
        {
          name: "evil",
          transport: "remote",
          url: "https://evil.example/mcp",
          enabled: true,
        },
      ],
      skills: [
        {
          name: "personal",
          files: [{ path: "SKILL.md", sha256: "b".repeat(64), size: 1 }],
        },
      ],
    });
    const merged = mergeConfig({
      layers: [
        { scope: "project", manifest: project },
        { scope: "user", manifest: user },
      ],
      lock: ConfigLockSchema.parse({
        forcedAgents: ["build"],
        denyMcp: ["evil"],
        lockMcp: true,
      }),
      role: "developer",
    });
    const build = merged.manifest.agents.find((item) => item.name === "build");
    expect(build?.prompt).toBe("project build");
    expect(merged.manifest.agents.map((item) => item.name)).toContain("notes");
    expect(merged.manifest.mcp.map((item) => item.name)).toEqual(["docs"]);
    expect(merged.manifest.skills.map((item) => item.name)).toEqual([
      "api-conventions",
      "personal",
    ]);
  });

  it("skips the user layer when overlay is disabled", () => {
    const user = manifest({
      agents: [{ name: "notes", description: "Notes", prompt: "notes" }],
    });
    const merged = mergeConfig({
      layers: [
        { scope: "project", manifest: project },
        { scope: "user", manifest: user },
      ],
      lock: ConfigLockSchema.parse({ allowUserOverlay: false, userOverlayWhitelist: [] }),
    });
    expect(merged.manifest.agents.map((item) => item.name)).toEqual(["build"]);
  });

  it("filters MCP by the current project role", () => {
    const merged = mergeConfig({
      layers: [{ scope: "project", manifest: project }],
      lock,
      role: "viewer",
    });
    expect(merged.manifest.mcp).toEqual([]);
  });

  it("hashes the same manifest regardless of key order", () => {
    const a = contentHash({ b: 1, a: { d: 1, c: 2 } });
    const b = contentHash({ a: { c: 2, d: 1 }, b: 1 });
    expect(a).toBe(b);
  });
});

describe("renderBundle", () => {
  it("renders opencode files and keeps secret values as placeholders", () => {
    const skill = Buffer.from("# Skill\n");
    const sha = contentHash(skill.toString("utf8"));
    const tree = renderBundle({
      runtimeType: "opencode",
      blobs: { [sha]: skill },
      existingFiles: {
        "opencode.json": JSON.stringify({ theme: "user", agent: { local: {} } }),
      },
      manifest: manifest({
        agents: [{ name: "build", description: "Build", prompt: "do the work", mode: "primary" }],
        mcp: [
          {
            name: "github",
            transport: "remote",
            url: "https://api.github.com/mcp",
            enabled: true,
            env: { TOKEN: { $secret: { kind: "projectCredential", id: "cred-1" } } },
          },
        ],
        skills: [{ name: "api-conventions", files: [{ path: "SKILL.md", sha256: sha, size: skill.length }] }],
        instructions: { agentsMd: "Follow the API conventions." },
        model: "anthropic/sonnet",
      }),
    });
    const paths = tree.files.map((item) => item.path).sort();
    expect(paths).toEqual([
      ".opencode/agents/build.md",
      ".opencode/skills/api-conventions/SKILL.md",
      "AGENTS.md",
      "opencode.json",
    ]);
    const config = tree.files.find((item) => item.path === "opencode.json")!.content.toString("utf8");
    const parsed = JSON.parse(config) as {
      theme?: string;
      mcp: { github: { env: { TOKEN: string } } };
    };
    expect(parsed.theme).toBe("user");
    expect(parsed.mcp.github.env.TOKEN).toBe("${secret:projectCredential:cred-1}");
    expect(config).not.toContain("sk-");
    expect(tree.apiOps.some((op) => op.op === "mcp.add" && op.name === "github")).toBe(true);
  });
});

describe("applyManagedTree", () => {
  it("restores managed files on rollback and leaves user files alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "ah-apply-"));
    await writeFile(join(root, "notes.txt"), "user file");
    const v1 = Buffer.from("# v1\n");
    const v2 = Buffer.from("# v2\n");
    await applyManagedTree(root, [
      { path: "AGENTS.md", content: v1 },
      { path: ".opencode/agents/build.md", content: Buffer.from("build v1") },
    ]);
    await applyManagedTree(root, [
      { path: "AGENTS.md", content: v2 },
      { path: ".opencode/agents/plan.md", content: Buffer.from("plan") },
    ]);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("# v2\n");
    await expect(readFile(join(root, ".opencode/agents/build.md"))).rejects.toThrow();
    await applyManagedTree(root, [
      { path: "AGENTS.md", content: v1 },
      { path: ".opencode/agents/build.md", content: Buffer.from("build v1") },
    ]);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("# v1\n");
    expect(await readFile(join(root, ".opencode/agents/build.md"), "utf8")).toBe("build v1");
    await expect(readFile(join(root, ".opencode/agents/plan.md"))).rejects.toThrow();
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("user file");
  });

  it("rejects symlink escape and paths outside the managed set", async () => {
    const root = await mkdtemp(join(tmpdir(), "ah-root-"));
    const outside = await mkdtemp(join(tmpdir(), "ah-out-"));
    await writeFile(join(root, ".opencode"), "");
    await import("node:fs/promises").then((fs) => fs.rm(join(root, ".opencode")));
    await import("node:fs/promises").then((fs) => fs.mkdir(join(root, ".opencode")));
    await symlink(outside, join(root, ".opencode", "agents"));
    await expect(
      applyManagedTree(root, [
        { path: ".opencode/agents/build.md", content: Buffer.from("nope") },
      ]),
    ).rejects.toThrow(/symlink/);
    await expect(
      applyManagedTree(root, [{ path: "../escape.md", content: Buffer.from("nope") }]),
    ).rejects.toThrow(/unsafe path/);
  });
});

describe("validateManifest", () => {
  it("rejects commands outside the whitelist and skills without SKILL.md", () => {
    const result = validateManifest({
      agents: [],
      mcp: [
        {
          name: "shell",
          transport: "local",
          command: ["bash", "-c", "echo"],
          enabled: true,
        },
      ],
      skills: [{ name: "bad", files: [{ path: "../x", sha256: "a".repeat(64), size: 1 }] }],
      instructions: {},
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.path).join(" ")).toMatch(/command|skills/);
  });
});
