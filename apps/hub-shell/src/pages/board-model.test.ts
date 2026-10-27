import { describe, expect, it } from "vitest";
import { fillIssuePrompt, sessionTitleForIssue, transitionAllowed } from "./board-model.js";

describe("board model", () => {
  it("requires the issue key in the session title and fills the prompt", () => {
    const issue = {
      key: "PROJ-1",
      title: "登录白屏",
      priority: "P1" as const,
      labels: ["前端"],
      description: "Safari 下白屏",
    };
    expect(sessionTitleForIssue(issue)).toContain("PROJ-1");
    const prompt = fillIssuePrompt(
      "处理 {{issue.key}} {{issue.title}} {{issue.priority}} {{issue.labels}}\n{{issue.description}}",
      issue,
    );
    expect(prompt).toContain("PROJ-1");
    expect(prompt).toContain("Safari 下白屏");
  });

  it("lets the owner force a jump and blocks an illegal developer move", () => {
    expect(transitionAllowed("todo", "done", false)).toBe(false);
    expect(transitionAllowed("todo", "done", true)).toBe(true);
    expect(transitionAllowed("in_progress", "in_review", false)).toBe(true);
  });
});
