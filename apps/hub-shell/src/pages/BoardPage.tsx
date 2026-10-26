import { useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  Avatar,
  Badge,
  Button,
  FilterToolbar,
  Icon,
  Input,
  PageHeader,
  Select,
  Stat,
  StatGrid,
  cn,
  ui,
} from "@agenthub/hub-ui-kit";
import { ArrowUpRight, Flag, LayoutGrid, List, Plus, RotateCcw } from "lucide-react";
import { useTenant } from "../auth/TenantProvider.js";

type Card = {
  id: string;
  title: string;
  desc: string;
  priority: "P0" | "P1" | "P2" | "P3";
  tags: string[];
  owner: string;
  date: string;
};

const COLUMNS: Array<{
  key: string;
  label: string;
  color: "gray" | "orange" | "purple" | "green";
  cards: Card[];
}> = [
  {
    key: "todo",
    label: "待办",
    color: "gray",
    cards: [
      {
        id: "23",
        title: "实现公共空间文件版本回滚",
        desc: "支持查看文件历史版本，并恢复到指定版本。",
        priority: "P2",
        tags: ["公共空间"],
        owner: "Jack",
        date: "10 月 30 日",
      },
      {
        id: "24",
        title: "完善租户级 RBAC 权限校验",
        desc: "补齐 Gateway 的租户过滤与成员访问规则。",
        priority: "P1",
        tags: ["权限", "后端"],
        owner: "Sarah",
        date: "10 月 28 日",
      },
    ],
  },
  {
    key: "in_progress",
    label: "进行中",
    color: "orange",
    cards: [
      {
        id: "21",
        title: "接入远程 OpenCode 实例",
        desc: "登记外部实例，经 Hub Facade 代理连接。",
        priority: "P1",
        tags: ["OpenCode", "实例"],
        owner: "Jack",
        date: "今天",
      },
    ],
  },
  {
    key: "in_review",
    label: "评审 / 验证",
    color: "purple",
    cards: [
      {
        id: "18",
        title: "项目共享凭据注入",
        desc: "会话创建时锁定凭据版本，服务端安全注入。",
        priority: "P0",
        tags: ["安全", "凭据"],
        owner: "Jack",
        date: "今天",
      },
    ],
  },
  {
    key: "done",
    label: "已解决",
    color: "green",
    cards: [
      {
        id: "16",
        title: "完成 Hub Shell 基础布局",
        desc: "统一导航、项目切换与个人工作区入口。",
        priority: "P2",
        tags: ["前端"],
        owner: "Alex",
        date: "昨天",
      },
    ],
  },
];

export function BoardPage() {
  const { projectId = "" } = useParams();
  const { projects } = useTenant();
  const key = projects.find((p) => p.id === projectId)?.key ?? "AH";
  const [view, setView] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");
  const [assignee, setAssignee] = useState("all");
  const [priority, setPriority] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COLUMNS.map((col) => ({
      ...col,
      cards: col.cards.filter((c) => {
        if (assignee !== "all" && c.owner !== assignee) return false;
        if (priority !== "all" && c.priority !== priority) return false;
        if (!q) return true;
        return (
          c.title.toLowerCase().includes(q) ||
          c.desc.toLowerCase().includes(q) ||
          `${key}-${c.id}`.toLowerCase().includes(q)
        );
      }),
    }));
  }, [assignee, key, priority, query]);

  const flat = filtered.flatMap((col) =>
    col.cards.map((c) => ({ ...c, status: col.label, statusKey: col.key })),
  );

  return (
    <>
      <PageHeader
        eyebrow="工作空间"
        title="项目看板"
        description="将想法变成行动，与 Agent 一起推进每一个问题。"
        actions={
          <>
            <Button variant="secondary" disabled title="P1">
              项目动态
            </Button>
            <Button variant="secondary" disabled title="P1">
              <Icon icon={ArrowUpRight} size="sm" />
              导出问题
            </Button>
            <Button disabled title="P1">
              <Icon icon={Plus} size="sm" />
              新建问题
            </Button>
          </>
        }
      />

      <StatGrid>
        {COLUMNS.map((col) => (
          <Stat
            key={col.key}
            label={col.label}
            icon={
              <span
                className={cn(
                  ui.boardDot,
                  col.color === "gray"
                    ? ui.boardDotGray
                    : col.color === "orange"
                      ? ui.boardDotOrange
                      : col.color === "purple"
                        ? ui.boardDotPurple
                        : ui.boardDotGreen,
                )}
              />
            }
            value={filtered.find((c) => c.key === col.key)?.cards.length ?? 0}
            note="示意列 · P1 接 Issue API"
          />
        ))}
      </StatGrid>

      <FilterToolbar
        leading={
          <div className={ui.viewToggle} role="group" aria-label="视图切换">
            <button
              type="button"
              className={cn(ui.viewToggleBtn, view === "board" && ui.viewToggleBtnActive)}
              onClick={() => setView("board")}
              aria-label="看板视图"
            >
              <Icon icon={LayoutGrid} size="sm" />
              看板
            </button>
            <button
              type="button"
              className={cn(ui.viewToggleBtn, view === "list" && ui.viewToggleBtnActive)}
              onClick={() => setView("list")}
              aria-label="列表视图"
            >
              <Icon icon={List} size="sm" />
              列表
            </button>
          </div>
        }
      >
        <label>
          <span className={ui.srOnly}>搜索问题</span>
          <Input
            variant="filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索问题…"
          />
        </label>
        <Select
          aria-label="按成员筛选"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="all">所有成员</option>
          <option value="Jack">Jack</option>
          <option value="Sarah">Sarah</option>
          <option value="Alex">Alex</option>
        </Select>
        <Select
          aria-label="按优先级筛选"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="all">所有优先级</option>
          {["P0", "P1", "P2", "P3"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setQuery("");
            setAssignee("all");
            setPriority("all");
          }}
          title="重置筛选"
        >
          <Icon icon={RotateCcw} size="sm" />
        </Button>
      </FilterToolbar>

      {view === "board" ? (
        <div className={ui.boardGrid}>
          {filtered.map((col) => (
            <section key={col.key} className={ui.boardColumn} aria-label={col.label}>
              <div className={ui.boardColumnHead}>
                <span className={cn(ui.boardDot, col.color==="gray"?ui.boardDotGray:col.color==="orange"?ui.boardDotOrange:col.color==="purple"?ui.boardDotPurple:ui.boardDotGreen)} />
                {col.label}
                <span className={ui.boardCount}>{col.cards.length}</span>
              </div>
              {col.cards.map((card) => (
                <article key={card.id} className={ui.issue}>
                  <div className={ui.issueTop}>
                    <span>
                      {key}-{card.id}
                    </span>
                    <span className={cn(ui.priority, "inline-flex items-center gap-1", card.priority==="P0"&&ui.priorityP0, card.priority==="P1"&&ui.priorityP1)}>
                      <Icon icon={Flag} size="xs" />
                      {card.priority}
                    </span>
                  </div>
                  <h3 className={ui.issueTitle}>{card.title}</h3>
                  <p>{card.desc}</p>
                  <div className={ui.labels}>
                    {card.tags.map((t) => (
                      <span
                        key={t}
                        className={cn(ui.tag, (t === "OpenCode" || t === "前端") && ui.tagBlue, (t === "凭据" || t === "权限") && ui.tagPurple)}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className={ui.issueBottom}>
                    <Avatar size="sm">{card.owner.slice(0, 1)}</Avatar>
                    <span>{card.owner}</span>
                    <span className="ml-auto">{card.date}</span>
                  </div>
                </article>
              ))}
              <button type="button" className={cn(ui.boardAdd, "inline-flex items-center gap-1")} disabled>
                <Icon icon={Plus} size="xs" />
                添加问题
              </button>
            </section>
          ))}
        </div>
      ) : (
        <div className={cn(ui.surface, ui.tableWrap)}>
          <table className={ui.dataTable}>
            <thead>
              <tr>
                <th>问题</th>
                <th>优先级</th>
                <th>状态</th>
                <th>负责人</th>
                <th>日期</th>
              </tr>
            </thead>
            <tbody>
              {flat.map((c) => (
                <tr key={c.id}>
                  <td>
                    <small>
                      {key}-{c.id}
                    </small>
                    <strong>{c.title}</strong>
                  </td>
                  <td>
                    <Badge tone={c.priority === "P0" ? "red" : "default"}>{c.priority}</Badge>
                  </td>
                  <td>{c.status}</td>
                  <td>{c.owner}</td>
                  <td>{c.date}</td>
                </tr>
              ))}
              {flat.length === 0 ? (
                <tr>
                  <td colSpan={5} className={ui.empty}>
                    没有匹配的问题
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
