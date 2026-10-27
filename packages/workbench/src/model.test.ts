import { describe, expect, it } from "vitest";
import type { Envelope } from "@agenthub/runtime-contract";
import {
  agentFileContentRequest,
  agentFileRequest,
  agentFindRequest,
  canEditFile,
  closeEditorTab,
  lineDiff,
  upsertEditorTab,
  applyEnvelope,
  browserMustNotCallAgent,
  sessionChangedPaths,
  toolPresentation,
  credentialSwitchLocked,
  isCommonPath,
  normalizeAgentFile,
  parseCredentialKey,
  showsAbort,
  showsFiles,
  showsFind,
  showsPermissions,
  showsTerminal,
} from "./model.js";

function envelope(type: Envelope["type"], data: Envelope["data"], seq = 1): Envelope {
  return { v: 1, seq, sessionId: "s1", ts: "2026-01-01T00:00:00.000Z", type, data };
}

describe("workbench stream model", () => {
  it("appends assistant deltas and tool cards", () => {
    const buf = new Map<string, string>();
    let lines = applyEnvelope(
      envelope("assistant.delta", { messageId: "m1", text: "你" }),
      [],
      buf,
    ).lines;
    lines = applyEnvelope(envelope("assistant.delta", { messageId: "m1", text: "好" }, 2), lines, buf).lines;
    lines = applyEnvelope(
      envelope("tool_call", { toolId: "t1", name: "read", input: { path: "README.md" } }, 3),
      lines,
      buf,
    ).lines;
    lines = applyEnvelope(
      envelope("tool_result", { toolId: "t1", output: "ok", isError: false }, 4),
      lines,
      buf,
    ).lines;

    expect(lines[0]).toMatchObject({ id: "m1", role: "assistant", text: "你好" });
    expect(lines[1]).toMatchObject({
      id: "t1",
      role: "tool",
      toolName: "read",
      toolPending: false,
      text: "ok",
      toolInput: { path: "README.md" },
    });
    expect(toolPresentation(lines[1]!).summary).toBe("/README.md");
  });

  it("keeps edited paths on the session change list and skips reads", () => {
    const lines = applyEnvelope(
      envelope("tool_call", {
        toolId: "t1",
        name: "edit",
        input: { path: "src/main.ts", oldString: "a", newString: "b" },
      }),
      [],
      new Map(),
    ).lines;
    expect(sessionChangedPaths(lines, [])).toEqual(["/src/main.ts"]);
    expect(toolPresentation(lines[0]!).diff).toEqual([
      { kind: "del", text: "a" },
      { kind: "add", text: "b" },
    ]);
    const read = applyEnvelope(
      envelope("tool_call", { toolId: "t2", name: "read", input: { path: "README.md" } }),
      [],
      new Map(),
    ).lines;
    expect(sessionChangedPaths(read, [])).toEqual([]);
  });

  it("opens a permission ask and clears it when resolved", () => {
    const ask = applyEnvelope(
      envelope("permission_request", {
        reqId: "r1",
        tool: "bash",
        input: { command: "ls" },
        options: ["allow", "deny"],
      }),
      [],
      new Map(),
    );
    expect(ask.permission?.reqId).toBe("r1");
    const done = applyEnvelope(
      envelope("permission_resolved", { reqId: "r1", decision: "deny" }),
      [],
      new Map(),
    );
    expect(done.permission).toBeNull();
    expect(done.lines[0]?.text).toContain("拒绝");
  });

  it("locks credential switching while any session is busy", () => {
    expect(credentialSwitchLocked(["idle", "active"])).toBe(false);
    expect(credentialSwitchLocked(["busy"])).toBe(true);
  });

  it("hides terminal, files, and permission UI when capabilities are off", () => {
    const caps = {
      v: 1 as const,
      files: false,
      find: false,
      lsp: false,
      pty: false,
      mcpRuntimeAdd: false,
      permissions: false,
      streaming: true,
      abort: false,
      usage: false,
    };
    expect(showsTerminal(caps)).toBe(false);
    expect(showsFiles(caps)).toBe(false);
    expect(showsFind(caps)).toBe(false);
    expect(showsPermissions(caps)).toBe(false);
    expect(showsAbort(caps)).toBe(false);
    expect(showsTerminal({ ...caps, pty: true })).toBe(true);
    expect(showsFiles({ ...caps, files: true })).toBe(true);
  });
});

describe("workbench files", () => {
  it("marks project-common as the shared zone and keeps personal files separate", () => {
    expect(isCommonPath("/project-common/docs/a.md")).toBe(true);
    expect(isCommonPath("/src/main.ts")).toBe(false);
    const listing = normalizeAgentFile(
      [
        { name: "README.md", type: "file" },
        { name: "project-common", type: "directory" },
      ],
      "/",
    );
    expect(listing.kind).toBe("directory");
    if (listing.kind !== "directory") return;
    expect(listing.entries[0]).toMatchObject({ path: "/README.md", zone: "personal" });
    expect(listing.entries[1]).toMatchObject({ path: "/project-common", zone: "common" });

    const file = normalizeAgentFile(
      { path: "/project-common/docs/architecture.md", type: "file", content: "# 公共" },
      "/project-common/docs/architecture.md",
    );
    expect(file).toMatchObject({ kind: "file", zone: "common", text: "# 公共" });
  });

  it("only builds allowlisted file and find reads", () => {
    expect(agentFileRequest("/README.md")).toBe("file?path=%2FREADME.md");
    expect(agentFileContentRequest("/src/main.ts")).toBe("file/content?path=%2Fsrc%2Fmain.ts");
    expect(agentFindRequest("docs")).toBe("find?q=docs");
    expect(browserMustNotCallAgent("GET", "/event")).toBe(true);
    expect(browserMustNotCallAgent("POST", "/session")).toBe(true);
    expect(browserMustNotCallAgent("PUT", "/auth/anthropic")).toBe(true);
    expect(browserMustNotCallAgent("PATCH", "/config")).toBe(true);
    expect(browserMustNotCallAgent("GET", "/file")).toBe(false);
    expect(browserMustNotCallAgent("PUT", "/file/content")).toBe(false);
    expect(parseCredentialKey("user:abc")).toEqual({ source: "user", id: "abc" });
  });
});

describe("workbench editor", () => {
  it("keeps a dirty draft and closes the active tab", () => {
    const opened = upsertEditorTab([], {
      path: "/src/main.ts",
      original: "a\n",
      draft: "a\n",
      zone: "personal",
      editable: true,
    });
    const dirty = opened.map((tab) => ({ ...tab, draft: "b\n" }));
    const reloaded = upsertEditorTab(dirty, {
      path: "/src/main.ts",
      original: "c\n",
      draft: "c\n",
      zone: "personal",
      editable: true,
    });
    expect(reloaded[0]).toMatchObject({ original: "c\n", draft: "b\n" });
    expect(closeEditorTab(reloaded, "/src/main.ts", "/src/main.ts").active).toBeNull();
    expect(canEditFile("common", "text")).toBe(false);
    expect(canEditFile("personal", null)).toBe(false);
    expect(canEditFile("personal", "text")).toBe(true);
  });

  it("diffs the open buffer against the saved text", () => {
    expect(lineDiff("a\nb\n", "a\nc\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "c" },
      { kind: "same", text: "" },
    ]);
  });
});
