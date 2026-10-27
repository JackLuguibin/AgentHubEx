import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeRuntime } from "./runtime.js";

describe("claude worker permissions and credentials", () => {
  it("turns an unanswered permission into timeout deny", async () => {
    const timers: Array<() => void> = [];
    const runtime = new ClaudeRuntime({
      schedule: (_ms, fn) => {
        timers.push(fn);
        return () => undefined;
      },
    });
    const { id } = runtime.createSession({ title: "perm" });
    await runtime.sendMessage(id, { parts: [{ type: "text", text: "ask permission" }] });
    await waitFor(() =>
      runtime.bus.snapshot(id).some((event) => event.type === "permission_request"),
    );
    expect(timers.length).toBe(1);
    timers[0]?.();
    await waitFor(() =>
      runtime.bus.snapshot(id).some((event) => {
        if (event.type !== "permission_resolved") return false;
        const data = event.data as { decision?: string };
        return data.decision === "timeout";
      }),
    );
  });

  it("keeps provider secrets in memory and writes only CLAUDE.md", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agenthub-claude-"));
    const runtime = new ClaudeRuntime({ cwd });
    const secret = "super-secret-value";
    await runtime.applyManifest({
      instructions: { agentsMd: "be brief" },
      mcp: [
        {
          name: "docs",
          transport: "local",
          command: ["node", "server.js"],
          env: { TOKEN: secret },
          enabled: true,
        },
      ],
    });
    runtime.setCredential({ provider: "anthropic", secret, sessionRef: "s1" });
    const text = await readFile(join(cwd, "CLAUDE.md"), "utf8");
    expect(text).toBe("be brief");
    const files = await readdir(cwd);
    expect(files).toEqual(["CLAUDE.md"]);
    expect(text.includes(secret)).toBe(false);
    expect(runtime.mcpNames()).toEqual(["docs"]);
    expect(runtime.credentialCount()).toBe(1);
  });

  it("keeps a hub proxy token and not a provider key", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agenthub-claude-proxy-"));
    const runtime = new ClaudeRuntime({ cwd });
    const providerKey = "sk-ant-real-provider-key";
    runtime.setCredential({
      provider: "anthropic",
      secret: "header.payload.signature",
      baseUrl: "http://hub.internal/llm/anthropic",
      sessionRef: "s1",
    });
    const material = runtime.proxyMaterial("s1");
    expect(material?.baseUrl).toBe("http://hub.internal/llm/anthropic");
    expect(material?.authorization).toBe("Bearer header.payload.signature");
    expect(runtime.holdsSecret(providerKey)).toBe(false);
    const files = await readdir(cwd);
    for (const file of files) {
      const text = await readFile(join(cwd, file), "utf8");
      expect(text.includes(providerKey)).toBe(false);
    }
  });
});

async function waitFor(pred: () => boolean) {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > 2_000) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
