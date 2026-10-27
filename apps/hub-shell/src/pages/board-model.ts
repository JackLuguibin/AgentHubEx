import type { Issue, IssueStatus } from "@agenthub/domain";

export const BOARD_COLUMNS: Array<{
  status: IssueStatus;
  label: string;
  color: "gray" | "orange" | "purple" | "green";
}> = [
  { status: "todo", label: "待办", color: "gray" },
  { status: "in_progress", label: "进行中", color: "orange" },
  { status: "in_review", label: "评审 / 验证", color: "purple" },
  { status: "done", label: "已解决", color: "green" },
];

export const STATUS_LABEL: Record<IssueStatus, string> = {
  todo: "待办",
  in_progress: "进行中",
  in_review: "评审 / 验证",
  done: "已解决",
  cancelled: "已取消",
};

const ALLOWED: Record<IssueStatus, IssueStatus[]> = {
  todo: ["in_progress", "cancelled"],
  in_progress: ["todo", "in_review", "done", "cancelled"],
  in_review: ["in_progress", "done", "cancelled"],
  done: ["in_progress"],
  cancelled: ["todo"],
};

export const DEFAULT_ISSUE_PROMPT = `你正在处理 {{issue.key}}: {{issue.title}}
优先级: {{issue.priority}}  标签: {{issue.labels}}
描述:
{{issue.description}}
参考资料位于 project-common/ 目录（只读）。`;

export function transitionAllowed(from: IssueStatus, to: IssueStatus, canForce: boolean) {
  if (from === to) return true;
  if (ALLOWED[from].includes(to)) return true;
  return canForce;
}

export function needsHumanConfirm(status: IssueStatus) {
  return status === "in_review" || status === "done";
}

export function canConfirmIssue(
  issue: Pick<Issue, "createdBy" | "assignee">,
  userId: string,
  canForce: boolean,
) {
  return canForce || issue.createdBy === userId || issue.assignee?.id === userId;
}

export function sessionTitleForIssue(issue: Pick<Issue, "key" | "title">) {
  return `${issue.key} · ${issue.title}`.slice(0, 200);
}

export function fillIssuePrompt(
  template: string,
  issue: Pick<Issue, "key" | "title" | "priority" | "labels" | "description">,
) {
  return template
    .replaceAll("{{issue.key}}", issue.key)
    .replaceAll("{{issue.title}}", issue.title)
    .replaceAll("{{issue.priority}}", issue.priority)
    .replaceAll("{{issue.labels}}", issue.labels.length > 0 ? issue.labels.join(", ") : "无")
    .replaceAll("{{issue.description}}", issue.description || "（无）");
}
