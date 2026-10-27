import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Command } from "cmdk";
import type { Issue, IssueStatus } from "@agenthub/domain";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Field,
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
import {
  ArrowUpRight,
  Flag,
  GripVertical,
  LayoutGrid,
  List,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";
import { Modal } from "../components/Modal.js";
import { api, API_BASE, getAccessToken } from "../lib/api.js";
import { getApiErrorMessage } from "../lib/api-error.js";
import { useToast } from "../lib/toast.js";
import {
  BOARD_COLUMNS,
  DEFAULT_ISSUE_PROMPT,
  STATUS_LABEL,
  canConfirmIssue,
  fillIssuePrompt,
  needsHumanConfirm,
  sessionTitleForIssue,
  transitionAllowed,
} from "./board-model.js";

const DOT: Record<string, string> = {
  gray: ui.boardDotGray,
  orange: ui.boardDotOrange,
  purple: ui.boardDotPurple,
  green: ui.boardDotGreen,
};

function formatWhen(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "今天";
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function columnId(status: IssueStatus) {
  return `col:${status}`;
}

function linkSummary(issue: Issue) {
  if (issue.linkedSessions.length === 0) return null;
  const mine = issue.linkedSessions.find((item) => item.canOpen);
  if (mine) return { mine, text: "打开我的会话" };
  const name = issue.linkedSessions[0]?.ownerName ?? "其他成员";
  const text =
    issue.linkedSessions.length > 1 ? `由 ${name} 等的会话处理` : `由 ${name} 的会话处理`;
  return { mine: null, text };
}

export function BoardPage() {
  const { projectId = "", issueKey } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projects } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const project = projects.find((item) => item.id === projectId) ?? null;
  const projectKey = project?.key ?? "AH";
  const canWrite = project?.myRole === "developer" || project?.myRole === "owner";
  const canForce = project?.myRole === "owner";

  const [view, setView] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");
  const [assignee, setAssignee] = useState("all");
  const [priority, setPriority] = useState("all");
  const [cancelledOpen, setCancelledOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQ, setPaletteQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createPriority, setCreatePriority] = useState<Issue["priority"]>("P2");
  const [confirmMove, setConfirmMove] = useState<{
    issue: Issue;
    to: "in_review" | "done";
    afterId?: string;
  } | null>(null);
  const [note, setNote] = useState("");
  const [sessionIssue, setSessionIssue] = useState<Issue | null>(null);
  const [prompt, setPrompt] = useState("");
  const [credential, setCredential] = useState("");
  const [engine, setEngine] = useState<"opencode" | "claude">("opencode");
  const [creating, setCreating] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);

  const boardKey = ["board", projectId, query, assignee, priority] as const;
  const boardQuery = useQuery({
    queryKey: boardKey,
    enabled: Boolean(projectId),
    refetchInterval: 15_000,
    queryFn: () =>
      api.getBoard(projectId, {
        q: query.trim() || undefined,
        assignee: assignee === "all" ? undefined : assignee,
        priority: priority === "all" ? undefined : (priority as Issue["priority"]),
        includeCancelled: true,
      }),
  });
  const membersQuery = useQuery({
    queryKey: ["project-members", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => (await api.listProjectMembers(projectId)).items,
  });
  const detailQuery = useQuery({
    queryKey: ["issue", projectId, issueKey],
    enabled: Boolean(projectId && issueKey),
    queryFn: () => api.getIssue(issueKey!),
  });
  const paletteQuery = useQuery({
    queryKey: ["issue-palette", projectId, paletteQ],
    enabled: paletteOpen && Boolean(projectId),
    queryFn: () => api.listIssues(projectId, { q: paletteQ.trim() || undefined }),
  });
  const optionsQuery = useQuery({
    queryKey: ["credential-options", projectId],
    enabled: Boolean(sessionIssue && projectId),
    queryFn: () => api.listCredentialOptions(projectId),
  });

  const columns = boardQuery.data?.columns ?? [];
  const byStatus = (status: IssueStatus) => columns.find((column) => column.status === status);
  const flat = columns.flatMap((column) => column.items);
  const detail =
    flat.find((issue) => issue.key === issueKey) ??
    (detailQuery.data?.key === issueKey ? detailQuery.data : null);

  useEffect(() => {
    if (searchParams.get("search") !== "1") return;
    setPaletteOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("search");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let timer: number | undefined;
    let delay = 1000;
    const connect = () => {
      void api
        .subscribeBoardEvents(projectId, {
          baseUrl: API_BASE || window.location.origin,
          getAccessToken,
          signal: ac.signal,
          onEvent: () => {
            delay = 1000;
            void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
          },
          onError: () => {
            if (ac.signal.aborted) return;
            timer = window.setTimeout(connect, delay);
            delay = Math.min(delay * 2, 30_000);
          },
        })
        .catch(() => undefined);
    };
    connect();
    return () => {
      ac.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [projectId, queryClient]);

  useEffect(() => {
    if (credential || !optionsQuery.data) return;
    const choice = optionsQuery.data.defaultChoice ?? optionsQuery.data.options[0];
    if (!choice) return;
    setCredential(`${choice.source}:${choice.id}`);
  }, [credential, optionsQuery.data]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const move = useMutation({
    mutationFn: async (input: {
      issue: Issue;
      to: IssueStatus;
      afterId?: string;
      resolutionNote?: string;
    }) => {
      const previous = queryClient.getQueryData(boardKey);
      if (!needsHumanConfirm(input.to)) {
        queryClient.setQueryData(boardKey, (current: typeof boardQuery.data) => {
          if (!current) return current;
          return {
            columns: current.columns.map((column) => {
              const items = column.items.filter((item) => item.id !== input.issue.id);
              const removed = items.length !== column.items.length;
              if (column.status !== input.to) {
                return { ...column, items, total: removed ? Math.max(0, column.total - 1) : column.total };
              }
              return {
                ...column,
                items: [{ ...input.issue, status: input.to }, ...items],
                total: column.total + (removed ? 0 : 1),
              };
            }),
          };
        });
      }
      try {
        await api.updateIssue(
          input.issue.id,
          {
            status: input.to,
            resolutionNote: input.resolutionNote,
            position: input.afterId ? { afterId: input.afterId } : undefined,
          },
          input.issue.etag,
        );
      } catch (err) {
        queryClient.setQueryData(boardKey, previous);
        throw err;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      if (issueKey) await queryClient.invalidateQueries({ queryKey: ["issue", projectId, issueKey] });
    },
    onError: async (err) => {
      toast(await getApiErrorMessage(err, "没能更新这张卡片"));
    },
  });

  function requestMove(issue: Issue, to: IssueStatus, afterId?: string) {
    if (issue.status === to && !afterId) return;
    if (!transitionAllowed(issue.status, to, canForce)) {
      toast("不能这样移动问题，请按待办、进行中、评审、已解决的顺序调整");
      return;
    }
    if (needsHumanConfirm(to) && issue.status !== to) {
      if (!user || !canConfirmIssue(issue, user.id, canForce)) {
        toast("只有负责人、创建人或项目 owner 可以移入评审或已解决");
        return;
      }
      setNote(issue.resolutionNote ?? "");
      setConfirmMove({ issue, to: to as "in_review" | "done", afterId });
      return;
    }
    move.mutate({ issue, to, afterId });
  }

  function onDragEnd(event: DragEndEvent) {
    if (!canWrite) return;
    const issue = flat.find((item) => item.id === String(event.active.id));
    if (!issue || !event.over) return;
    const overId = String(event.over.id);
    if (overId === issue.id) return;
    if (overId.startsWith("col:")) {
      requestMove(issue, overId.slice(4) as IssueStatus);
      return;
    }
    const overIssue = flat.find((item) => item.id === overId);
    if (!overIssue) return;
    requestMove(issue, overIssue.status, overIssue.id);
  }

  function openDetail(issue: Issue) {
    navigate(`/p/${projectId}/issues/${issue.key}`);
  }

  function closeDetail() {
    navigate(`/p/${projectId}/board`);
  }

  function openSession(issue: Issue) {
    const template = project?.settings.issuePromptTemplate || DEFAULT_ISSUE_PROMPT;
    setPrompt(fillIssuePrompt(template, issue));
    setCredential("");
    setSessionIssue(issue);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(flat, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectKey}-issues.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const members = membersQuery.data ?? [];
  const cancelled = byStatus("cancelled");

  return (
    <>
      <PageHeader
        eyebrow="工作空间"
        title="项目看板"
        description="将想法变成行动，与 Agent 一起推进每一个问题。"
        actions={
          <>
            <Button variant="secondary" onClick={() => setPaletteOpen(true)}>
              <Icon icon={Search} size="sm" />
              搜索问题
            </Button>
            <Button variant="secondary" onClick={exportJson} disabled={flat.length === 0}>
              <Icon icon={ArrowUpRight} size="sm" />
              导出问题
            </Button>
            <Button
              disabled={!canWrite}
              onClick={() => {
                setCreateTitle("");
                setCreateDescription("");
                setCreatePriority("P2");
                setCreateOpen(true);
              }}
            >
              <Icon icon={Plus} size="sm" />
              新建问题
            </Button>
          </>
        }
      />

      {boardQuery.isError ? (
        <Banner>看板加载失败。请确认你是这个项目的成员，然后刷新页面。</Banner>
      ) : null}

      <StatGrid>
        {BOARD_COLUMNS.map((column) => (
          <Stat
            key={column.status}
            label={column.label}
            icon={<span className={cn(ui.boardDot, DOT[column.color])} />}
            value={byStatus(column.status)?.total ?? 0}
            note="当前筛选下的数量"
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索问题…"
          />
        </label>
        <Select aria-label="按成员筛选" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
          <option value="all">所有成员</option>
          <option value="me">我负责的</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.displayName}
            </option>
          ))}
        </Select>
        <Select
          aria-label="按优先级筛选"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        >
          <option value="all">所有优先级</option>
          {["P0", "P1", "P2", "P3"].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="secondary"
          title="重置筛选"
          onClick={() => {
            setQuery("");
            setAssignee("all");
            setPriority("all");
          }}
        >
          <Icon icon={RotateCcw} size="sm" />
        </Button>
      </FilterToolbar>

      {boardQuery.isLoading ? <p className="text-[11px] text-[#667085]">正在加载看板…</p> : null}

      {view === "board" ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className={ui.boardGrid}>
              {BOARD_COLUMNS.map((column) => (
                <BoardColumn
                  key={column.status}
                  status={column.status}
                  label={column.label}
                  color={column.color}
                  issues={byStatus(column.status)?.items ?? []}
                  total={byStatus(column.status)?.total ?? 0}
                  canWrite={canWrite}
                  projectId={projectId}
                  onOpen={openDetail}
                  onCreate={
                    column.status === "todo" || column.status === "in_progress"
                      ? () => {
                          setCreateTitle("");
                          setCreateDescription("");
                          setCreatePriority("P2");
                          setCreateOpen(true);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
            <CancelledLane
              open={cancelledOpen}
              total={cancelled?.total ?? 0}
              issues={cancelled?.items ?? []}
              canWrite={canWrite}
              projectId={projectId}
              onToggle={() => setCancelledOpen((value) => !value)}
              onOpen={openDetail}
            />
          </div>
        </DndContext>
      ) : (
        <IssueTable issues={flat} onOpen={openDetail} />
      )}

      <IssueSearch
        open={paletteOpen}
        query={paletteQ}
        issues={paletteQuery.data?.items ?? []}
        onQuery={setPaletteQ}
        onOpenChange={setPaletteOpen}
        onPick={(issue) => {
          setPaletteOpen(false);
          openDetail(issue);
        }}
      />

      <Modal
        open={createOpen}
        title="新建问题"
        onClose={() => setCreateOpen(false)}
        footer={
          <Button
            disabled={!createTitle.trim() || creating}
            onClick={() => {
              void (async () => {
                setCreating(true);
                try {
                  const created = await api.createIssue(projectId, {
                    title: createTitle.trim(),
                    description: createDescription.trim(),
                    priority: createPriority,
                    status: "todo",
                  });
                  setCreateOpen(false);
                  await queryClient.invalidateQueries({ queryKey: ["board", projectId] });
                  openDetail(created);
                } catch (err) {
                  toast(await getApiErrorMessage(err, "没能创建问题"));
                } finally {
                  setCreating(false);
                }
              })();
            }}
          >
            创建
          </Button>
        }
      >
        <div className="grid gap-3">
          <Field label="标题">
            <Input variant="field" value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} />
          </Field>
          <Field label="描述">
            <textarea
              className={cn(ui.fieldControl, ui.fieldTextarea, "text-[#344054]")}
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
            />
          </Field>
          <Field label="优先级">
            <Select variant="field" value={createPriority} onChange={(event) => setCreatePriority(event.target.value as Issue["priority"])}>
              {["P0", "P1", "P2", "P3"].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal open={Boolean(issueKey)} title={detail ? detail.key : "问题"} onClose={closeDetail} wide>
        {detailQuery.isLoading && !detail ? <p>正在加载…</p> : null}
        {detailQuery.isError && !detail ? <p>找不到这个问题，或你没有查看权限。</p> : null}
        {detail ? (
          <IssueDetail
            issue={detail}
            projectId={projectId}
            canWrite={canWrite}
            canForce={canForce}
            userId={user?.id ?? ""}
            onMove={(to) => requestMove(detail, to)}
            onSession={() => openSession(detail)}
          />
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmMove)}
        title={confirmMove?.to === "done" ? "确认已解决" : "确认进入评审"}
        onClose={() => setConfirmMove(null)}
        footer={
          <Button
            disabled={!note.trim() || move.isPending}
            onClick={() => {
              if (!confirmMove) return;
              move.mutate(
                {
                  issue: confirmMove.issue,
                  to: confirmMove.to,
                  afterId: confirmMove.afterId,
                  resolutionNote: note.trim(),
                },
                { onSuccess: () => setConfirmMove(null) },
              );
            }}
          >
            {confirmMove &&
            user &&
            canForce &&
            !canConfirmIssue(confirmMove.issue, user.id, false)
              ? "强制确认"
              : "确认"}
          </Button>
        }
      >
        <Field
          label={confirmMove?.to === "done" ? "解决说明" : "验证说明"}
          hint="进入评审或已解决必须留下说明。只有负责人、创建人或项目 owner 可以确认。"
        >
          <textarea
            className={cn(ui.fieldControl, ui.fieldTextarea, "text-[#344054]")}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </Modal>

      <Modal
        open={Boolean(sessionIssue)}
        title={sessionIssue ? `用 Agent 解决 ${sessionIssue.key}` : "用 Agent 解决"}
        onClose={() => setSessionIssue(null)}
        wide
        footer={
          <Button
            disabled={!sessionIssue || !credential || sessionBusy}
            onClick={() => {
              if (!sessionIssue || sessionBusy) return;
              const [source, id] = credential.split(":");
              if (!source || !id) {
                toast("请先选择凭据");
                return;
              }
              void (async () => {
                setSessionBusy(true);
                try {
                  const session = await api.createSession(projectId, {
                    title: sessionTitleForIssue(sessionIssue),
                    runtimeType: engine,
                    credentialSource: source as "user" | "project",
                    credentialId: id,
                    issueId: sessionIssue.id,
                    initialPrompt: prompt,
                  });
                  setSessionIssue(null);
                  navigate(`/p/${projectId}/workbench?session=${session.id}`);
                } catch (err) {
                  toast(await getApiErrorMessage(err, "没能创建会话"));
                } finally {
                  setSessionBusy(false);
                }
              })();
            }}
          >
            创建会话
          </Button>
        }
      >
        <div className="grid gap-3">
          <Field label="引擎" hint="Claude 不提供文件树和终端，工作台会按能力隐藏。">
            <Select
              variant="field"
              value={engine}
              onChange={(event) => setEngine(event.target.value as "opencode" | "claude")}
            >
              <option value="opencode">OpenCode</option>
              <option value="claude">Claude</option>
            </Select>
          </Field>
          <Field label="凭据">
            <Select variant="field" value={credential} onChange={(event) => setCredential(event.target.value)}>
              <option value="">选择凭据</option>
              {(optionsQuery.data?.options ?? []).map((option) => (
                <option key={`${option.source}:${option.id}`} value={`${option.source}:${option.id}`}>
                  {option.label}（{option.source === "project" ? "项目" : "个人"}）
                </option>
              ))}
            </Select>
          </Field>
          {(optionsQuery.data?.options.length ?? 0) === 0 && !optionsQuery.isLoading ? (
            <p>还没有可用凭据。请先到凭据页添加，再回来开会话。</p>
          ) : null}
          <Field label="首条消息" hint="会作为这个会话的第一条消息发出。">
            <textarea
              className={cn(ui.fieldControl, ui.fieldTextarea, "min-h-40 text-[#344054]")}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}

function BoardColumn({
  status,
  label,
  color,
  issues,
  total,
  canWrite,
  projectId,
  onOpen,
  onCreate,
}: {
  status: IssueStatus;
  label: string;
  color: string;
  issues: Issue[];
  total: number;
  canWrite: boolean;
  projectId: string;
  onOpen: (issue: Issue) => void;
  onCreate?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(status) });
  return (
    <section
      ref={setNodeRef}
      className={cn(ui.boardColumn, isOver && "ring-2 ring-[#8ca2f1]")}
      aria-label={label}
    >
      <div className={ui.boardColumnHead}>
        <span className={cn(ui.boardDot, DOT[color])} />
        {label}
        <span className={ui.boardCount}>{total}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {issues.map((issue) => (
          <IssueCard
            key={issue.id}
            issue={issue}
            projectId={projectId}
            canWrite={canWrite}
            onOpen={onOpen}
          />
        ))}
        {onCreate ? (
          <button
            type="button"
            className={cn(ui.boardAdd, "inline-flex items-center gap-1", canWrite && "cursor-pointer text-[#667085]")}
            disabled={!canWrite}
            onClick={onCreate}
          >
            <Icon icon={Plus} size="xs" />
            添加问题
          </button>
        ) : null}
      </div>
    </section>
  );
}

function CancelledLane({
  open,
  total,
  issues,
  canWrite,
  projectId,
  onToggle,
  onOpen,
}: {
  open: boolean;
  total: number;
  issues: Issue[];
  canWrite: boolean;
  projectId: string;
  onToggle: () => void;
  onOpen: (issue: Issue) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId("cancelled") });
  return (
    <section ref={setNodeRef} className={cn("shrink-0", isOver && "rounded-lg ring-2 ring-[#8ca2f1]")}>
      <button type="button" className="text-[11px] text-[#667085]" onClick={onToggle}>
        {open ? "收起" : "展开"}已取消（{total}）
      </button>
      {open ? (
        <div className="mt-2 grid gap-2">
          {issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              projectId={projectId}
              canWrite={canWrite}
              onOpen={onOpen}
            />
          ))}
          {issues.length === 0 ? <p className="text-[11px] text-[#98a2b3]">没有已取消的问题</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function IssueCard({
  issue,
  projectId,
  canWrite,
  onOpen,
}: {
  issue: Issue;
  projectId: string;
  canWrite: boolean;
  onOpen: (issue: Issue) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    disabled: !canWrite,
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: issue.id });
  const summary = linkSummary(issue);
  return (
    <article
      ref={(node) => {
        setNodeRef(node);
        setDropRef(node);
      }}
      className={cn(ui.issue, isDragging && "opacity-60")}
      tabIndex={0}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button, a")) return;
        onOpen(issue);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(issue);
        }
      }}
    >
      <div className={ui.issueTop}>
        <span>{issue.key}</span>
        <span className="inline-flex items-center gap-1">
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
          {canWrite ? (
            <button
              type="button"
              className="cursor-grab border-0 bg-transparent p-0 text-[#98a2b3]"
              aria-label={`拖拽 ${issue.key}`}
              {...listeners}
              {...attributes}
            >
              <Icon icon={GripVertical} size="xs" />
            </button>
          ) : null}
        </span>
      </div>
      <h3 className={ui.issueTitle}>{issue.title}</h3>
      {issue.description ? <p className={cn(ui.issueDesc, "line-clamp-3")}>{issue.description}</p> : null}
      {issue.labels.length > 0 ? (
        <div className={ui.labels}>
          {issue.labels.map((label) => (
            <span key={label} className={ui.tag}>
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {summary ? (
        <div className={ui.issueSession}>
          {summary.mine ? (
            <Link to={`/p/${projectId}/workbench?session=${summary.mine.id}`}>{summary.text}</Link>
          ) : (
            <span>{summary.text}</span>
          )}
        </div>
      ) : null}
      <div className={ui.issueBottom}>
        <Avatar size="sm">{(issue.assignee?.displayName ?? "?").slice(0, 1)}</Avatar>
        <span>{issue.assignee?.displayName ?? "未分配"}</span>
        <span className="ml-auto">{formatWhen(issue.updatedAt)}</span>
      </div>
    </article>
  );
}

function IssueTable({ issues, onOpen }: { issues: Issue[]; onOpen: (issue: Issue) => void }) {
  return (
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
          {issues.map((issue) => (
            <tr key={issue.id} className="cursor-pointer" onClick={() => onOpen(issue)}>
              <td>
                <small>{issue.key}</small>
                <strong>{issue.title}</strong>
              </td>
              <td>
                <Badge tone={issue.priority === "P0" ? "red" : "default"}>{issue.priority}</Badge>
              </td>
              <td>{STATUS_LABEL[issue.status]}</td>
              <td>{issue.assignee?.displayName ?? "未分配"}</td>
              <td>{formatWhen(issue.updatedAt)}</td>
            </tr>
          ))}
          {issues.length === 0 ? (
            <tr>
              <td colSpan={5} className={ui.empty}>
                没有匹配的问题
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function IssueDetail({
  issue,
  projectId,
  canWrite,
  canForce,
  userId,
  onMove,
  onSession,
}: {
  issue: Issue;
  projectId: string;
  canWrite: boolean;
  canForce: boolean;
  userId: string;
  onMove: (status: IssueStatus) => void;
  onSession: () => void;
}) {
  const targets = (["todo", "in_progress", "in_review", "done", "cancelled"] as IssueStatus[]).filter(
    (status) => status !== issue.status && transitionAllowed(issue.status, status, canForce),
  );
  return (
    <div className="grid gap-3 text-[#344054]">
      <h3 className="m-0 text-sm font-semibold text-[#182230]">{issue.title}</h3>
      <p className="m-0 whitespace-pre-wrap">{issue.description || "没有描述"}</p>
      <p className="m-0">
        {STATUS_LABEL[issue.status]} · {issue.priority} · {issue.assignee?.displayName ?? "未分配"}
      </p>
      {issue.resolutionNote ? <p className="m-0">说明：{issue.resolutionNote}</p> : null}
      <div className="grid gap-1">
        {issue.linkedSessions.length === 0 ? <span>还没有关联会话</span> : null}
        {issue.linkedSessions.map((session) =>
          session.canOpen ? (
            <Link key={session.id} to={`/p/${projectId}/workbench?session=${session.id}`}>
              打开我的会话：{session.title}
            </Link>
          ) : (
            <span key={session.id}>
              由 {session.ownerName} 的会话处理（{session.title}）
            </span>
          ),
        )}
      </div>
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onSession}>
            用 Agent 解决
          </Button>
          {targets.map((status) => (
            <Button
              key={status}
              type="button"
              variant="secondary"
              onClick={() => onMove(status)}
              disabled={needsHumanConfirm(status) && !canConfirmIssue(issue, userId, canForce)}
            >
              {STATUS_LABEL[status]}
            </Button>
          ))}
        </div>
      ) : (
        <p className="m-0">你是查看者，只能看这块看板。</p>
      )}
    </div>
  );
}

function IssueSearch({
  open,
  query,
  issues,
  onQuery,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  query: string;
  issues: Issue[];
  onQuery: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onPick: (issue: Issue) => void;
}) {
  const items = useMemo(() => issues, [issues]);
  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="搜索问题" shouldFilter={false}>
      <Command.Input
        value={query}
        onValueChange={onQuery}
        placeholder="搜索问题标题、描述或编号"
      />
      <Command.List>
        <Command.Empty>没有匹配的问题</Command.Empty>
        {items.map((issue) => (
          <Command.Item key={issue.id} value={issue.id} onSelect={() => onPick(issue)}>
            <span className="text-[#98a2b3]">{issue.key}</span>
            <span>{issue.title}</span>
            <span className="ml-auto text-[#98a2b3]">{STATUS_LABEL[issue.status]}</span>
          </Command.Item>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
