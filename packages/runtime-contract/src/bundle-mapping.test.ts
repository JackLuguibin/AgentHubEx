import { describe, expect, it } from "vitest";
import {
  CLAUDE_BUNDLE_OPTION_MAP,
  CLAUDE_PATHS,
  classifyPermission,
  mapBundleToClaudeOptions,
} from "./bundle-mapping.js";

describe("bundle to claude options", () => {
  it("covers every row of the architecture mapping table", () => {
    const fields = CLAUDE_BUNDLE_OPTION_MAP.map((row) => row.effective);
    expect(fields).toEqual([
      "model",
      "instructions.agentsMd",
      "agents",
      "mcp.local",
      "mcp.remote",
      "skills",
      "permission",
      "cwd",
    ]);
  });

  it("maps instructions, agents, mcp, skills, and permission", () => {
    const options = mapBundleToClaudeOptions({
      model: "claude-sonnet",
      cwd: "/workspace",
      instructions: { agentsMd: "be brief", extra: ["cite sources"] },
      agents: [
        {
          name: "review",
          description: "reviews code",
          prompt: "look carefully",
          tools: { read: true, bash: false },
          model: "claude-haiku",
        },
      ],
      mcp: [
        {
          name: "local-docs",
          transport: "local",
          command: ["node", "server.js"],
          env: { TOKEN: "kept-in-memory" },
          enabled: true,
        },
        {
          name: "remote-docs",
          transport: "remote",
          url: "http://127.0.0.1:9/sse",
          headers: { authorization: "placeholder" },
          enabled: true,
        },
        { name: "off", transport: "remote", url: "http://127.0.0.1:9/no", enabled: false },
      ],
      skills: [{ name: "review" }],
      permission: {
        read: "allow",
        bash: "ask",
        write: { "*": "allow", "project-common/**": "deny" },
        edit: "deny",
      },
    });

    expect(options.model).toBe("claude-sonnet");
    expect(options.cwd).toBe("/workspace");
    expect(options.settingSources).toEqual(["project"]);
    expect(options.claudeMd).toContain("be brief");
    expect(options.systemPrompt).toEqual({
      preset: "claude_code",
      append: "be brief\n\ncite sources",
    });
    expect(options.agents.review).toMatchObject({
      description: "reviews code",
      prompt: "look carefully",
      tools: ["read"],
      model: "claude-haiku",
    });
    expect(options.mcpServers["local-docs"]).toEqual({
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: { TOKEN: "kept-in-memory" },
    });
    expect(options.mcpServers["remote-docs"]).toMatchObject({ type: "sse" });
    expect(options.mcpServers.off).toBeUndefined();
    expect(options.skillFiles).toEqual([CLAUDE_PATHS.skill("review", "SKILL.md")]);
    expect(options.allowedTools).toEqual(["read"]);
    expect(options.disallowedTools).toEqual(["edit"]);
    expect(options.permissionRules.write).toBe("ask");
    expect(options.permissionMode).toBe("default");
    expect(classifyPermission("deny")).toBe("deny");
  });

  it("uses dontAsk when every tool is allow or deny", () => {
    const options = mapBundleToClaudeOptions({
      permission: { read: "allow", edit: "deny" },
    });
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.cwd).toBe("/workspace");
  });
});
