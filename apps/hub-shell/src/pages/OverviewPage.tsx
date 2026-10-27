import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { Issue, IssueStatus } from "@agenthub/domain";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Icon,
  PageHeader,
  Stat,
  StatGrid,
  cn,
  ui,
} from "@agenthub/hub-ui-kit";
import {
  ArrowUpRight,
  Check,
  CircleDot,
  Flag,
  Hexagon,
  Info,
  LayoutGrid,
} from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";

const STATUS_LABEL: Record<IssueStatus, string> = {
  todo: "待办",
  in_progress: "进行中",
  in_review: "评审",
  done: "已解决",
  cancelled: "已取消",
};

function columnTotal(
  columns: { status: IssueStatus; total: number }[] | undefined,
  status: IssueStatus,
) {
  return columns?.find((column) => column.status === status)?.total ?? 0;
}

export function OverviewPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { projects, tenantId } = useTenant();
  const project = projects.find((item) => item.id === projectId);

  const boardQuery = useQuery({
    queryKey: ["board", projectId, "overview"],
    enabled: Boolean(projectId),
    queryFn: () => api.getBoard(projectId),
  });
  const sessionsQuery = useQuery({
    queryKey: ["sessions", projectId, "overview"],
    enabled: Boolean(projectId),
    queryFn: () => api.listSessions(projectId),
  });
  const instancesQuery = useQuery({
    queryKey: ["instances", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => (await api.listInstances(tenantId!)).items,
  });
  const bindingsQuery = useQuery({
    queryKey: ["bindings", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => (await api.getProjectBindings(projectId)).bindings,
  });
  const issuesQuery = useQuery({
    queryKey: ["issues", projectId, "overview"],
    enabled: Boolean(projectId),
    queryFn: () => api.listIssues(projectId),
  });

  const columns = boardQuery.data?.columns;
  const issues = [...(issuesQuery.data?.items ?? [])].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : -1,
  );
  const mine = issues.filter(
    (issue) =>
      (issue.status === "todo" || issue.status === "in_progress") &&
      (issue.assignee == null || issue.assignee.id === user?.id),
  );
  const boundIds = new Set(
    (bindingsQuery.data ?? []).map((binding) => binding.instanceId).filter(Boolean),
  );
  const bound = (instancesQuery.data ?? []).filter((instance) => boundIds.has(instance.id));
  const healthy = bound.filter((instance) => instance.health === "healthy").length;
  const sessionCount = sessionsQuery.data?.items.length ?? 0;

  const firstName = user?.displayName?.split(/\s+/)[0] ?? "你好";
  const hour = new Date().getHours();
  const greet = hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";

  return (
    <>
      <PageHeader
        title="每一次协作，都有新的进展。"
        description={`${greet}，${firstName}。这里是你的项目运行概况。`}
        actions={
          <Button onClick={() => navigate(`/p/${projectId}/workbench`)}>
            进入我的工作台
            <Icon icon={ArrowUpRight} size="sm" />
          </Button>
        }
      />

      <StatGrid>
        <Stat
          label="待办问题"
          icon={<Icon icon={LayoutGrid} size="sm" className="text-[#98a2b3]" />}
          value={columnTotal(columns, "todo")}
          note="来自项目看板"
        />
        <Stat
          label="进行中"
          icon={<Icon icon={CircleDot} size="sm" className="text-[#98a2b3]" />}
          value={columnTotal(columns, "in_progress")}
          note={
            <>
              <strong>{sessionCount}</strong> 个我的会话
            </>
          }
        />
        <Stat
          label="评审 / 已解决"
          icon={<Icon icon={Check} size="sm" className="text-[#98a2b3]" />}
          value={
            <>
              {columnTotal(columns, "in_review")}
              <small> / {columnTotal(columns, "done")}</small>
            </>
          }
          note="评审数 / 已解决数"
        />
        <Stat
          label="在线实例"
          icon={<Icon icon={Hexagon} size="sm" className="text-[#98a2b3]" />}
          value={
            <>
              {healthy}
              <small>/{bound.length}</small>
            </>
          }
          note="已绑定到本项目且健康的实例"
        />
      </StatGrid>

      <Banner icon={Info}>
        数字来自看板、会话和实例接口。没有内容时显示 0，不会再用示例问题充数。
      </Banner>

      <div className={ui.grid2}>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>我的待办</h2>
            <Link className={cn(ui.textLink, "inline-flex items-center gap-1")} to={`/p/${projectId}/board`}>
              打开看板
              <Icon icon={ArrowUpRight} size="xs" />
            </Link>
          </div>
          {mine.length === 0 ? (
            <p className={ui.inlineNote}>没有指派给你、或尚未指派的待办和进行中问题。</p>
          ) : (
            mine.slice(0, 6).map((issue) => <IssueRow key={issue.id} issue={issue} name={firstName} />)
          )}
        </div>

        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>最近更新</h2>
            <Link className={cn(ui.textLink, "inline-flex items-center gap-1")} to={`/p/${projectId}/board`}>
              查看看板
              <Icon icon={ArrowUpRight} size="xs" />
            </Link>
          </div>
          {issues.length === 0 ? (
            <p className={ui.inlineNote}>这个项目还没有问题。</p>
          ) : (
            issues.slice(0, 6).map((issue) => (
              <div key={issue.id} className={ui.activityRow}>
                <Avatar tone="green">{(issue.assignee?.displayName ?? "·").slice(0, 2)}</Avatar>
                <span>
                  <strong>{issue.key}</strong> {issue.title}
                </span>
                <time>{STATUS_LABEL[issue.status]}</time>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function IssueRow({ issue, name }: { issue: Issue; name: string }) {
  return (
    <article className={ui.issue}>
      <div className={ui.issueTop}>
        <span>{issue.key}</span>
        <span
          className={cn(
            ui.priority,
            "inline-flex items-center gap-1",
            issue.priority === "P0" && ui.priorityP0,
            issue.priority === "P1" && ui.priorityP1,
          )}
        >
          <Icon icon={Flag} size="xs" />
          {issue.priority}
        </span>
      </div>
      <h3 className={ui.issueTitle}>{issue.title}</h3>
      {issue.description ? <p>{issue.description}</p> : null}
      <div className={ui.issueBottom}>
        <Avatar tone="green">{(issue.assignee?.displayName ?? name).slice(0, 2)}</Avatar>
        <span>{issue.assignee?.displayName ?? "未指派"}</span>
        <span className="ml-auto">{STATUS_LABEL[issue.status]}</span>
      </div>
    </article>
  );
}
