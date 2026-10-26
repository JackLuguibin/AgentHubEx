import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
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
  Circle,
  CircleDot,
  Command,
  Flag,
  Hexagon,
  Info,
  LayoutGrid,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";

type DemoIssue = {
  id: string;
  title: string;
  desc: string;
  priority: "P0" | "P1" | "P2";
  tags: string[];
  session?: boolean;
};

/** Design-faithful overview: live session count + prototype-aligned layout cards. */
export function OverviewPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { projects } = useTenant();
  const project = projects.find((p) => p.id === projectId);
  const [sessionCount, setSessionCount] = useState<number | null>(null);

  useEffect(() => {
    if (!projectId) return;
    void api
      .listSessions(projectId)
      .then((page) => setSessionCount(page.items.length))
      .catch(() => setSessionCount(0));
  }, [projectId]);

  const firstName = user?.displayName?.split(/\s+/)[0] ?? "你好";
  const hour = new Date().getHours();
  const greet =
    hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";

  const todos: DemoIssue[] = [
    {
      id: "23",
      title: "实现公共空间文件版本回滚",
      desc: "支持查看文件历史版本，并恢复到指定版本。",
      priority: "P2",
      tags: ["公共空间"],
    },
    {
      id: "21",
      title: "接入远程 OpenCode 实例",
      desc: "登记外部实例，经 Hub Facade 代理连接。",
      priority: "P1",
      tags: ["OpenCode", "实例"],
      session: true,
    },
    {
      id: "18",
      title: "项目共享凭据注入",
      desc: "会话创建时锁定凭据版本，服务端安全注入。",
      priority: "P0",
      tags: ["安全", "凭据"],
    },
  ];

  const key = project?.key ?? "AH";

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
          value={
            <>
              3 <small>+3 本周</small>
            </>
          }
          note="看板 API 接入后实时刷新"
        />
        <Stat
          label="进行中"
          icon={<Icon icon={CircleDot} size="sm" className="text-[#98a2b3]" />}
          value={
            <>
              {sessionCount ?? "—"}
              <small>我的会话</small>
            </>
          }
          note={
            <>
              <strong>{sessionCount ?? 0}</strong> 个活跃会话（本人）
            </>
          }
        />
        <Stat
          label="本周已解决"
          icon={<Icon icon={Check} size="sm" className="text-[#98a2b3]" />}
          value={
            <>
              2{" "}
              <small className="inline-flex items-center gap-0.5">
                <Icon icon={TrendingUp} size="xs" />
                100%
              </small>
            </>
          }
          note="示意指标 · P1 接 Issue"
        />
        <Stat
          label="在线实例"
          icon={<Icon icon={Hexagon} size="sm" className="text-[#98a2b3]" />}
          value={
            <>
              1<small>/1</small>
            </>
          }
          note={
            <>
              <strong>mock</strong> runtime 已就绪
            </>
          }
        />
      </StatGrid>

      <Banner icon={Info}>
        项目边界已就绪：成员使用独立工作区，Provider 凭据由 Hub 注入，公共资料以只读方式同步。
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
          {todos.map((issue) => (
            <article key={issue.id} className={ui.issue}>
              <div className={ui.issueTop}>
                <span>
                  {key}-{issue.id}
                </span>
                <span className={cn(ui.priority, "inline-flex items-center gap-1", issue.priority==="P0"&&ui.priorityP0, issue.priority==="P1"&&ui.priorityP1)}>
                  <Icon icon={Flag} size="xs" />
                  {issue.priority}
                </span>
              </div>
              <h3 className={ui.issueTitle}>{issue.title}</h3>
              <p>{issue.desc}</p>
              <div className={ui.labels}>
                {issue.tags.map((t) => (
                  <span
                    key={t}
                    className={cn(ui.tag, t==="OpenCode"&&ui.tagBlue, t==="凭据"&&ui.tagPurple)}
                  >
                    {t}
                  </span>
                ))}
              </div>
              {issue.session ? (
                <div className={ui.issueSession}>
                  <i className="inline-block h-1.5 w-1.5 rounded-full bg-[#12a16f]" /> Agent 可关联会话
                </div>
              ) : null}
              <div className={ui.issueBottom}>
                <Avatar tone="green">{(user?.displayName ?? "U").slice(0, 2)}</Avatar>
                <span>{firstName}</span>
                <span className="ml-auto">设计示意</span>
              </div>
            </article>
          ))}
        </div>

        <div>
          <div className={cn(ui.surface, ui.panel)}>
            <div className={ui.panelTitle}>
              <h2 className={ui.panelTitleH2}>运行环境</h2>
              <Link className={cn(ui.textLink, "inline-flex items-center gap-1")} to={`/p/${projectId}/instances`}>
                管理实例
                <Icon icon={ArrowUpRight} size="xs" />
              </Link>
            </div>
            <p className={ui.inlineNote}>配置 Bundle · 公共文件（P1）</p>
            <div className={ui.healthRow}>
              <span className={ui.engineLogo}>
                <Icon icon={Command} size="sm" />
              </span>
              <div>
                <div>OpenCode</div>
                <small>首版可用 · Facade 会话路径</small>
              </div>
              <Badge tone="green" className="inline-flex items-center gap-1">
                <Icon icon={Circle} size="xs" className="fill-current" />
                健康
              </Badge>
            </div>
            <div className={ui.healthRow}>
              <span className={ui.engineLogo}>
                <Icon icon={Sparkles} size="sm" />
              </span>
              <div>
                <div>Claude Agent SDK</div>
                <small>Phase 3 规划</small>
              </div>
              <span className={ui.badge}>规划中</span>
            </div>
          </div>

          <div className={cn(ui.surface, ui.panel)} style={{ marginTop: 18 }}>
            <div className={ui.panelTitle}>
              <h2 className={ui.panelTitleH2}>项目动态</h2>
              <Link className={cn(ui.textLink, "inline-flex items-center gap-1")} to={`/p/${projectId}/audit`}>
                查看全部
                <Icon icon={ArrowUpRight} size="xs" />
              </Link>
            </div>
            {[
              ["创建了个人会话", "刚刚"],
              ["完成 seed 与 Facade 联调", "今天"],
              ["对齐 HTML 控制台壳层", "今天"],
            ].map(([text, time]) => (
              <div key={text} className={ui.activityRow}>
                <Avatar tone="green">{(user?.displayName ?? "U").slice(0, 2)}</Avatar>
                <span>
                  <strong>{user?.displayName ?? "你"}</strong> {text}
                </span>
                <time>{time}</time>
              </div>
            ))}
          </div>

          <div className={cn(ui.surface, ui.panel)} style={{ marginTop: 18 }}>
            <div className={ui.panelTitle}>
              <h2 className={ui.panelTitleH2}>交付阶段</h2>
              <Badge tone="green">Phase 0→1</Badge>
            </div>
            <p className={ui.inlineNote}>
              当前：远程接入 · 配置下发 · 公共空间 · 项目看板
            </p>
            <div className={ui.metricBar}>
              <i style={{ width: "38%" }} />
            </div>
            <p className={ui.inlineNote}>
              下一阶段：托管编排 → 双引擎对齐 → 生产加固
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
