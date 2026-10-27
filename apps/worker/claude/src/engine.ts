import type { ClaudeAgentOptions } from "@agenthub/runtime-contract";
import type { ToolDecision } from "./permission-bridge.js";

export type EngineRun = {
  prompt: string;
  messageId: string;
  options: ClaudeAgentOptions;
  canUseTool: (tool: string, input: unknown) => Promise<ToolDecision>;
  signal: AbortSignal;
  hasCredential: boolean;
  credentialProvider?: string;
};

export type ClaudeEngine = {
  run(input: EngineRun): AsyncIterable<unknown>;
};

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** In-process stand-in for the Claude Agent SDK. Never calls a public model host. */
export const mockClaudeEngine: ClaudeEngine = {
  async *run(input) {
    const messageId = input.messageId;
    if (/abort/i.test(input.prompt)) {
      while (!input.signal.aborted) await sleep(15, input.signal);
      return;
    }

    yield {
      type: "assistant",
      message: {
        id: messageId,
        content: [{ type: "tool_use", id: "tool_read", name: "read", input: { path: "README.md" } }],
      },
    };
    yield {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tool_read", content: "mock: README.md", is_error: false }],
      },
    };

    if (/permission/i.test(input.prompt)) {
      const decision = await input.canUseTool("bash", { command: "ls" });
      if (input.signal.aborted) return;
      if (decision.behavior === "deny") {
        yield {
          type: "result",
          subtype: "error",
          is_error: true,
          result: "permission denied",
          model: "mock",
          usage: { input_tokens: 1, output_tokens: 1 },
        };
        return;
      }
    }

    if (/model/i.test(input.prompt) && !input.hasCredential) {
      yield {
        type: "result",
        subtype: "error",
        is_error: true,
        result: "no credential",
        model: "mock",
        usage: { input_tokens: 0, output_tokens: 0 },
      };
      return;
    }

    const text = `收到：${input.prompt}`;
    for (let index = 0; index < text.length; index += 12) {
      if (input.signal.aborted) return;
      yield {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: text.slice(index, index + 12) },
        },
      };
    }
    yield {
      type: "assistant",
      message: { id: messageId, content: [{ type: "text", text }] },
    };
    yield {
      type: "result",
      subtype: "success",
      is_error: false,
      result: text,
      model: input.credentialProvider ? `mock:${input.credentialProvider}` : "mock-unscoped",
      usage: { input_tokens: 3, output_tokens: text.length },
    };
  },
};

type SdkQuery = (args: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

/** Loads the official SDK only when a deployment turns the mock off. */
export function createSdkEngine(): ClaudeEngine {
  return {
    async *run(input) {
      const load = new Function("specifier", "return import(specifier)") as (
        specifier: string,
      ) => Promise<{ query?: SdkQuery }>;
      const sdk = await load("@anthropic-ai/claude-agent-sdk");
      if (!sdk.query) throw new Error("Claude Agent SDK did not export query()");
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (input.signal.aborted) controller.abort();
      else input.signal.addEventListener("abort", onAbort, { once: true });
      try {
        yield* sdk.query({
          prompt: input.prompt,
          options: {
            model: input.options.model,
            cwd: input.options.cwd,
            settingSources: input.options.settingSources,
            systemPrompt: input.options.systemPrompt,
            agents: input.options.agents,
            mcpServers: input.options.mcpServers,
            allowedTools: input.options.allowedTools,
            disallowedTools: input.options.disallowedTools,
            permissionMode: input.options.permissionMode,
            abortController: controller,
            canUseTool: (toolName: string, toolInput: unknown) => input.canUseTool(toolName, toolInput),
          },
        });
      } finally {
        input.signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
