import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { runConformance } from "@agenthub/runtime-contract";
import { opencodeAdapter } from "./index.js";

const RECORDED_SSE = [
  `data: ${JSON.stringify({ type: "session.status", properties: { sessionID: "s2", status: "busy" } })}`,
  "",
  `data: ${JSON.stringify({ type: "session.status", properties: { sessionID: "s1", status: "busy" } })}`,
  "",
  `data: ${JSON.stringify({
    type: "message.part.updated",
    properties: {
      sessionID: "s1",
      messageID: "m1",
      part: { type: "text", text: "hi" },
    },
  })}`,
  "",
  `data: ${JSON.stringify({
    type: "message.part.updated",
    properties: {
      sessionID: "s1",
      messageID: "m1",
      part: { type: "tool", id: "t1", tool: "read", state: { status: "running" }, input: { path: "README.md" } },
    },
  })}`,
  "",
  `data: ${JSON.stringify({
    type: "permission.asked",
    properties: { sessionID: "s1", id: "p1", permission: "bash", input: { command: "ls" } },
  })}`,
  "",
  `data: ${JSON.stringify({
    type: "message.updated",
    properties: {
      sessionID: "s1",
      info: { role: "assistant", id: "m1", modelID: "mock", tokens: { input: 1, output: 2 } },
    },
  })}`,
  "",
  `data: ${JSON.stringify({ type: "session.idle", properties: { sessionID: "s1" } })}`,
  "",
  `data: ${JSON.stringify({ type: "session.error", properties: { sessionID: "s1", message: "boom" } })}`,
  "",
  "",
].join("\n");

describe("recorded opencode sse", () => {
  it("normalizes the fixture into envelopes and drops other sessions", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/event") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(RECORDED_SSE);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    try {
      const events = [];
      for await (const event of opencodeAdapter.events(
        { baseUrl: `http://127.0.0.1:${address.port}` },
        { sessionRef: "s1" },
      )) {
        events.push(event);
      }
      expect(events.map((event) => event.type)).toEqual([
        "session.status",
        "assistant.delta",
        "tool_call",
        "permission_request",
        "assistant.message",
        "usage",
        "session.status",
        "result",
        "error",
      ]);
      expect(events.every((event) => event.sessionRef === "s1")).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("contract-opencode", () => {
  it("passes the shared runtime contract on the mock engine", async () => {
    await runConformance(opencodeAdapter, { baseUrl: "mock://opencode", mock: true });
  });
});
