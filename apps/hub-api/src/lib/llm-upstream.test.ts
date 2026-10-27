import { describe, expect, it } from "vitest";
import {
  createUsageAccumulator,
  providerUpstreamUrl,
  upstreamAuthHeaders,
} from "./llm-upstream.js";

describe("llm upstream", () => {
  it("joins the provider base URL without leaving that host", () => {
    expect(providerUpstreamUrl("https://gateway.corp.local/v1", "/v1/messages")).toBe(
      "https://gateway.corp.local/v1/messages",
    );
    expect(providerUpstreamUrl("https://api.anthropic.com", "/v1/messages")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
    expect(() => providerUpstreamUrl("https://api.anthropic.com", "https://evil.example")).toThrow();
  });

  it("sends the provider key and drops the inbound proxy token", () => {
    const incoming = new Headers({
      authorization: "Bearer proxy-token",
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    });
    const headers = upstreamAuthHeaders("anthropic", "sk-real", incoming);
    expect(headers.get("x-api-key")).toBe("sk-real");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("reads anthropic JSON and merged SSE usage", () => {
    const json = createUsageAccumulator();
    json.push('{"model":"claude-test","usage":{"input_tokens":11,"output_tokens":7}}');
    json.finish();
    expect(json.usage).toMatchObject({ model: "claude-test", inputTokens: 11, outputTokens: 7, seen: true });

    const sse = createUsageAccumulator("from-request");
    sse.push(
      'event: message_start\ndata: {"message":{"model":"claude-sse","usage":{"input_tokens":4}}}\n\n',
    );
    sse.push('event: message_delta\ndata: {"usage":{"output_tokens":9}}\n\n');
    sse.finish();
    expect(sse.usage).toMatchObject({
      model: "claude-sse",
      inputTokens: 4,
      outputTokens: 9,
      seen: true,
    });
  });
});
