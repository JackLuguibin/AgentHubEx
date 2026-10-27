import { describe, expect, it } from "vitest";
import { classifyAgentUpstreamPath } from "./agent-allowlist.js";

describe("A10 blocked agent paths", () => {
  it("rejects auth, config, event, and session", () => {
    expect(classifyAgentUpstreamPath("PUT", "/auth/anthropic")).toBe("block");
    expect(classifyAgentUpstreamPath("PATCH", "/config")).toBe("block");
    expect(classifyAgentUpstreamPath("GET", "/event")).toBe("block");
    expect(classifyAgentUpstreamPath("POST", "/session")).toBe("block");
  });

  it("allows read-only file and find", () => {
    expect(classifyAgentUpstreamPath("GET", "/file")).toBe("allow");
    expect(classifyAgentUpstreamPath("GET", "/find")).toBe("allow");
    expect(classifyAgentUpstreamPath("PUT", "/file")).toBe("block");
  });
});
