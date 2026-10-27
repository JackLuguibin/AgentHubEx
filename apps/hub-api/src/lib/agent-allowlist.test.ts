import { describe, expect, it } from "vitest";
import {
  classifyAgentUpstreamPath,
  personalFileWriteAllowed,
  ptyGateOpen,
  tenantAllowsPty,
} from "./agent-allowlist.js";

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

  it("allows personal text writes and keeps session paths blocked", () => {
    expect(classifyAgentUpstreamPath("PUT", "/file/content")).toBe("file-write");
    expect(classifyAgentUpstreamPath("GET", "/file/content")).toBe("allow");
    expect(classifyAgentUpstreamPath("POST", "/pty")).toBe("pty");
    expect(classifyAgentUpstreamPath("GET", "/pty/abc/connect")).toBe("pty");
    expect(classifyAgentUpstreamPath("GET", "/pty/../session")).toBe("block");
    expect(personalFileWriteAllowed("/src/main.ts")).toBe(true);
    expect(personalFileWriteAllowed("/project-common/docs/a.md")).toBe(false);
    expect(personalFileWriteAllowed("/../etc/passwd")).toBe(false);
    expect(personalFileWriteAllowed("/.agenthub/secret")).toBe(false);
  });

  it("opens pty only when the runtime and the tenant both allow it", () => {
    expect(ptyGateOpen({ pty: true }, {})).toBe(true);
    expect(ptyGateOpen({ pty: false }, {})).toBe(false);
    expect(ptyGateOpen({ pty: true }, { ptyEnabled: false })).toBe(false);
    expect(tenantAllowsPty(undefined)).toBe(true);
    expect(tenantAllowsPty({ ptyEnabled: false })).toBe(false);
  });
});
