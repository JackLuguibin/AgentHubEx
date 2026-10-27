import { describe, expect, it } from "vitest";
import { mapClaudeSdkMessage } from "./claude-events.js";

describe("claude sdk event mapping", () => {
  it("maps stream deltas, tool use, tool results, usage, and errors", () => {
    expect(
      mapClaudeSdkMessage(
        {
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } },
        },
        "m1",
      ),
    ).toEqual([{ type: "assistant.delta", data: { messageId: "m1", text: "hi" } }]);

    expect(
      mapClaudeSdkMessage(
        {
          type: "assistant",
          message: {
            id: "m1",
            content: [
              { type: "text", text: "done" },
              { type: "tool_use", id: "t1", name: "read", input: { path: "README.md" } },
            ],
          },
        },
        "m1",
      ),
    ).toEqual([
      {
        type: "tool_call",
        data: { toolId: "t1", name: "read", input: { path: "README.md" } },
      },
      { type: "assistant.message", data: { messageId: "m1", text: "done" } },
    ]);

    expect(
      mapClaudeSdkMessage(
        {
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "t1", content: "ok", is_error: false }],
          },
        },
        "m1",
      ),
    ).toEqual([
      { type: "tool_result", data: { toolId: "t1", output: "ok", isError: false } },
    ]);

    const result = mapClaudeSdkMessage(
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "done",
        model: "mock:anthropic",
        usage: { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 1 },
      },
      "m1",
    );
    expect(result.map((event) => event.type)).toEqual(["usage", "result"]);
    expect(result[0]?.data).toMatchObject({
      model: "mock:anthropic",
      inputTokens: 2,
      outputTokens: 4,
      cacheRead: 1,
    });

    const failed = mapClaudeSdkMessage(
      { type: "result", subtype: "error", is_error: true, result: "no credential" },
      "m1",
    );
    expect(failed.map((event) => event.type)).toEqual(["error", "result"]);
  });
});
