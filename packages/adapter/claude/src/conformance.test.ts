import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runConformance } from "@agenthub/runtime-contract";
import { listenClaudeWorker } from "@agenthub/worker-claude";
import { claudeAdapter } from "./index.js";
import { normalizeWorkerEvent } from "./index.js";

describe("claude adapter", () => {
  it("normalizes a raw SDK message into envelopes", () => {
    const events = normalizeWorkerEvent({
      type: "assistant",
      message: {
        id: "m1",
        content: [{ type: "tool_use", id: "t1", name: "read", input: { path: "README.md" } }],
      },
    });
    expect(events.map((event) => event.type)).toEqual(["tool_call"]);
    expect(events[0]?.data).toMatchObject({ toolId: "t1", name: "read" });
  });
});

describe("contract-claude", () => {
  let close: (() => Promise<void>) | undefined;

  afterAll(async () => {
    await close?.();
  });

  it("passes the shared runtime contract against worker/claude", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agenthub-contract-"));
    const worker = await listenClaudeWorker({ token: "contract-token", cwd });
    close = worker.close;
    await runConformance(claudeAdapter, {
      baseUrl: worker.url,
      auth: { username: "agenthub", password: "contract-token" },
    });
  });
});
