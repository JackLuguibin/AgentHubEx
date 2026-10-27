import { useEffect, useRef, useState } from "react";
import type { AgentSession, CredentialOptionsRes, Workspace } from "@agenthub/domain";
import type { FacadeClient } from "@agenthub/agent-client";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Icon,
  PageHeader,
  Select,
  cn,
  ui,
} from "@agenthub/hub-ui-kit";
import { Command, Folder, Plus, RefreshCw, Send, Terminal } from "lucide-react";
import {
  agentFileRequest,
  agentFindRequest,
  applyEnvelope,
  credentialKey,
  credentialSwitchLocked,
  extractText,
  normalizeAgentFile,
  parentAgentPath,
  parseCredentialKey,
  showsAbort,
  showsFiles,
  showsFind,
  showsPermissions,
  showsTerminal,
  type AgentFileNode,
  type ChatLine,
  type PermissionAsk,
} from "./model.js";

export type WorkbenchProps = {
  projectId: string;
  projectLabel?: string;
  client: FacadeClient;
  getAccessToken: () => string | null;
  apiBase: string;
  initialSessionId?: string | null;
  onSessionChange?: (sessionId: string | null) => void;
};

const READY = new Set(["ready", "ready_degraded", "idle"]);

export function Workbench({
  projectId,
  projectLabel = "Project",
  client,
  getAccessToken,
  apiBase,
  initialSessionId,
  onSessionChange,
}: WorkbenchProps) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamStatus, setStreamStatus] = useState<"idle" | "live" | "error">("idle");
  const [streamGen, setStreamGen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [explorerTab, setExplorerTab] = useState<"sessions" | "files">("sessions");
  const [mobilePane, setMobilePane] = useState<"files" | "chat" | "code">("chat");
  const [options, setOptions] = useState<CredentialOptionsRes | null>(null);
  const [credentialValue, setCredentialValue] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [permission, setPermission] = useState<PermissionAsk | null>(null);
  const [cwd, setCwd] = useState("/");
  const [entries, setEntries] = useState<AgentFileNode[]>([]);
  const [preview, setPreview] = useState<{ path: string; text: string | null; zone: "personal" | "common" } | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const lastEventId = useRef<string | undefined>(undefined);
  const linesRef = useRef<ChatLine[]>([]);
  const assistantBuf = useRef<Map<string, string>>(new Map());
  const staleTries = useRef(0);
  const capsRef = useRef(workspace?.capabilities);
  const bottomRef = useRef<HTMLDivElement>(null);

  capsRef.current = workspace?.capabilities;
  const replaceLines = (next: ChatLine[]) => {
    linesRef.current = next;
    setLines(next);
  };
  const active = sessions.find((item) => item.id === sessionId) ?? null;
  const locked = credentialSwitchLocked(sessions.map((item) => item.status));
  const filesOn = showsFiles(workspace?.capabilities);
  const findOn = showsFind(workspace?.capabilities);
  const terminalOn = showsTerminal(workspace?.capabilities);
  const tab = filesOn ? explorerTab : "sessions";

  const selectSession = (id: string | null) => {
    setSessionId(id);
    onSessionChange?.(id);
  };

  const refreshSessions = async () => {
    const page = await client.listSessions(projectId);
    setSessions(page.items);
    return page.items;
  };

  useEffect(() => {
    let cancelled = false;
    setCredentialValue("");
    setOptions(null);
    setPreview(null);
    setEntries([]);
    setCwd("/");
    void client
      .listCredentialOptions(projectId)
      .then((page) => {
        if (cancelled) return;
        setOptions(page);
      })
      .catch((err: unknown) => {
        if (!cancelled) void readError(err, "加载凭据失败").then(setError);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, client]);

  useEffect(() => {
    if (credentialValue || !options) return;
    if (options.defaultChoice) {
      setCredentialValue(credentialKey(options.defaultChoice.source, options.defaultChoice.id));
      return;
    }
    const only = options.options.length === 1 ? options.options[0] : null;
    if (only) setCredentialValue(credentialKey(only.source, only.id));
  }, [options, credentialValue]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const load = async () => {
      try {
        const next = await client.getWorkspaceMe(projectId);
        if (cancelled) return;
        setWorkspace(next);
        if (!READY.has(next.status)) timer = window.setTimeout(() => void load(), 2000);
      } catch (err: unknown) {
        if (!cancelled) void readError(err, "加载工作区失败").then(setError);
      }
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectId, client]);

  useEffect(() => {
    void refreshSessions()
      .then((items) => {
        setSessionId((current) => {
          if (current && items.some((item) => item.id === current)) return current;
          const next = items[0]?.id ?? null;
          if (next) onSessionChange?.(next);
          return next;
        });
      })
      .catch((err: unknown) => {
        void readError(err, "加载会话失败").then(setError);
      });
  }, [projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, permission]);

  useEffect(() => {
    if (!sessionId) {
      replaceLines([]);
      setPermission(null);
      setStreamStatus("idle");
      return;
    }

    const ac = new AbortController();
    replaceLines([]);
    setPermission(null);
    assistantBuf.current.clear();
    setStreamStatus("idle");

    void (async () => {
      try {
        const history = await client.listMessages(sessionId);
        replaceLines(
          history.items.map((message) => ({
            id: message.id,
            role: message.role,
            text: extractText(message.parts),
          })),
        );
      } catch {
        /* history can be empty while the runtime is still starting */
      }

      try {
        await client.subscribeSessionEvents(sessionId, {
          baseUrl: apiBase,
          getAccessToken,
          signal: ac.signal,
          lastEventId: lastEventId.current,
          onOpen: () => {
            staleTries.current = 0;
            setStreamStatus("live");
          },
          onStale: () => {
            staleTries.current += 1;
            lastEventId.current = undefined;
            if (staleTries.current <= 2) setStreamGen((value) => value + 1);
            else setStreamStatus("error");
          },
          onEvent: (envelope) => {
            lastEventId.current = String(envelope.seq);
            const applied = applyEnvelope(envelope, linesRef.current, assistantBuf.current);
            replaceLines(applied.lines);
            if (applied.sessionStatus) {
              setSessions((items) =>
                items.map((item) =>
                  item.id === sessionId ? { ...item, status: applied.sessionStatus! } : item,
                ),
              );
            }
            if (applied.staleCursor) {
              lastEventId.current = undefined;
              setStreamGen((value) => value + 1);
            }
            if (applied.permission && showsPermissions(capsRef.current)) setPermission(applied.permission);
            else if (applied.permission === null) setPermission(null);
          },
          onError: () => setStreamStatus("error"),
        });
      } catch {
        if (!ac.signal.aborted) setStreamStatus("error");
      }
    })();

    return () => ac.abort();
  }, [sessionId, apiBase, client, getAccessToken, streamGen]);

  useEffect(() => {
    if (!workspace?.id || !filesOn) return;
    let cancelled = false;
    void client
      .agentGet(workspace.id, agentFileRequest("/"))
      .then((body) => {
        if (cancelled) return;
        const normalized = normalizeAgentFile(body, "/");
        if (normalized.kind === "directory") {
          setCwd("/");
          setEntries(normalized.entries);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) void readError(err, "读取文件树失败").then(setError);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace?.id, filesOn, client]);

  const openPath = async (path: string, kind: "file" | "directory") => {
    if (!workspace?.id) return;
    setError(null);
    try {
      const body = await client.agentGet(workspace.id, agentFileRequest(path));
      const normalized = normalizeAgentFile(body, path);
      if (kind === "directory" || normalized.kind === "directory") {
        if (normalized.kind !== "directory") return;
        setCwd(path);
        setEntries(normalized.entries);
        setPreview(null);
        return;
      }
      setPreview({ path: normalized.path, text: normalized.text, zone: normalized.zone });
    } catch (err: unknown) {
      setError(await readError(err, "读取文件失败"));
    }
  };

  const onFind = async () => {
    if (!workspace?.id || !findQuery.trim()) return;
    try {
      const body = await client.agentGet(workspace.id, agentFindRequest(findQuery.trim()));
      const normalized = normalizeAgentFile(body, "/");
      if (normalized.kind === "directory") setEntries(normalized.entries);
    } catch (err: unknown) {
      setError(await readError(err, "搜索文件失败"));
    }
  };

  const onCreate = async () => {
    const picked = parseCredentialKey(credentialValue);
    if (!picked) {
      setError("请先选择凭据");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await client.createSession(projectId, {
        title: "新会话",
        credentialSource: picked.source,
        credentialId: picked.id,
      });
      await refreshSessions();
      selectSession(session.id);
    } catch (err: unknown) {
      setError(await readError(err, "创建会话失败"));
    } finally {
      setBusy(false);
    }
  };

  const onRename = async () => {
    if (!sessionId || !titleDraft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await client.patchSession(sessionId, { title: titleDraft.trim() });
      setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setRenaming(false);
    } catch (err: unknown) {
      setError(await readError(err, "重命名失败"));
    } finally {
      setBusy(false);
    }
  };

  const onArchive = async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      await client.archiveSession(sessionId);
      const items = await refreshSessions();
      selectSession(items[0]?.id ?? null);
    } catch (err: unknown) {
      setError(await readError(err, "归档失败"));
    } finally {
      setBusy(false);
    }
  };

  const onAbort = async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await client.abortSession(sessionId);
      setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err: unknown) {
      setError(await readError(err, "停止失败"));
    } finally {
      setBusy(false);
    }
  };

  const onSend = async () => {
    if (!sessionId || !draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    setBusy(true);
    setError(null);
    replaceLines([...linesRef.current, { id: `local-${Date.now()}`, role: "user", text }]);
    setSessions((items) =>
      items.map((item) => (item.id === sessionId ? { ...item, status: "busy" } : item)),
    );
    try {
      await client.sendMessage(sessionId, { parts: [{ type: "text", text }] });
    } catch (err: unknown) {
      setError(await readError(err, "发送失败"));
    } finally {
      setBusy(false);
    }
  };

  const onDecision = async (decision: "allow" | "deny" | "always") => {
    if (!sessionId || !permission) return;
    const current = permission;
    setPermission(null);
    try {
      await client.respondPermission(sessionId, current.reqId, decision);
      replaceLines(
        applyEnvelope(
          {
            v: 1,
            seq: Date.now(),
            sessionId,
            ts: new Date().toISOString(),
            type: "permission_resolved",
            data: { reqId: current.reqId, decision },
          },
          linesRef.current,
          assistantBuf.current,
        ).lines,
      );
    } catch (err: unknown) {
      setPermission(current);
      setError(await readError(err, "提交权限决定失败"));
    }
  };

  const onSyncConfig = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await client.applyConfig(projectId, {});
      setNotice(`已提交配置同步（${result.jobs.length} 个任务），并写入审计`);
    } catch (err: unknown) {
      setError(await readError(err, "同步配置失败"));
    } finally {
      setBusy(false);
    }
  };

  const onSyncCommon = async () => {
    if (!workspace?.id) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const job = await client.syncCommon(workspace.id);
      setNotice(`已提交公共资料同步（${job.status}），并写入审计`);
    } catch (err: unknown) {
      setError(await readError(err, "同步公共资料失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 [.ah-main_&]:min-h-0">
      <PageHeader
        eyebrow="工作空间"
        title="我的工作台"
        description="个人会话与工作区 · 仅你可见"
        actions={
          <>
            <Button
              variant="secondary"
              disabled={busy || !workspace?.id}
              onClick={() => void onSyncConfig()}
            >
              <Icon icon={RefreshCw} size="sm" />
              同步配置
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !workspace?.id}
              onClick={() => void onSyncCommon()}
            >
              同步公共资料
            </Button>
            <Button disabled={busy || !credentialValue} onClick={() => void onCreate()}>
              <Icon icon={Plus} size="sm" />
              新建会话
            </Button>
          </>
        }
      />

      <Banner
        icon={Folder}
        trailing={
          <span className="flex gap-2">
            <Badge tone={streamStatus === "live" ? "live" : "default"}>
              {streamStatus === "live" ? "SSE live" : streamStatus === "error" ? "已断开" : "待命"}
            </Badge>
            <span className={ui.badge}>React Workbench · Hub Facade</span>
          </span>
        }
      >
        /workspace · {projectLabel}
        {workspace ? ` · ${workspace.status}` : ""}
        {streamStatus === "live" ? " · 实时已连接" : ""}
        {streamStatus === "error" ? " · 实时连接已断开，消息仍可发送" : ""}
        {" · 公共空间只读"}
      </Banner>

      {error ? <p className="text-[11px] text-[#b42318]">{error}</p> : null}
      {notice ? <p className="text-[11px] text-[#067647]">{notice}</p> : null}

      <div className="mb-0 flex gap-1 max-[680px]:flex min-[681px]:hidden" role="tablist" aria-label="工作台面板">
        {(
          [
            ["files", "文件"],
            ["chat", "会话"],
            ["code", "代码"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mobilePane === id}
            className={cn(
              "flex-1 cursor-pointer rounded-md border border-[#e1e6ee] bg-[#eef1f6] px-2.5 py-2 text-[10px] text-[#667085]",
              mobilePane === id && "border-[#c9d4f5] bg-white font-[550] text-ah-accent",
            )}
            onClick={() => {
              setMobilePane(id);
              if (id === "files" && filesOn) setExplorerTab("files");
              if (id === "chat") setExplorerTab("sessions");
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        data-pane={mobilePane}
        className={cn(
          ui.surface,
          "grid min-h-0 flex-[320px] overflow-hidden",
          "grid-cols-1 min-[681px]:grid-cols-[minmax(140px,160px)_minmax(0,1fr)] min-[1201px]:grid-cols-[minmax(145px,190px)_minmax(0,1fr)_minmax(190px,250px)]",
          "max-[680px]:data-[pane=files]:[&>*:nth-child(2)]:hidden max-[680px]:data-[pane=files]:[&>*:nth-child(3)]:hidden",
          "max-[680px]:data-[pane=chat]:[&>*:nth-child(1)]:hidden max-[680px]:data-[pane=chat]:[&>*:nth-child(3)]:hidden",
          "max-[680px]:data-[pane=code]:[&>*:nth-child(1)]:hidden max-[680px]:data-[pane=code]:[&>*:nth-child(2)]:hidden",
          "max-[1200px]:[&>*:nth-child(3)]:hidden",
        )}
      >
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-ah-line bg-[#fafbfc] max-[680px]:border-r-0">
          <div className="flex h-[42px] shrink-0 gap-4 border-b border-ah-line px-3">
            {filesOn ? (
              <button
                type="button"
                className={cn(
                  "cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-0.5 text-[11px] text-[#667085]",
                  tab === "files" && "border-ah-accent font-semibold text-ah-accent",
                )}
                onClick={() => setExplorerTab("files")}
              >
                文件
              </button>
            ) : null}
            <button
              type="button"
              className={cn(
                "cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-0.5 text-[11px] text-[#667085]",
                tab === "sessions" && "border-ah-accent font-semibold text-ah-accent",
              )}
              onClick={() => setExplorerTab("sessions")}
            >
              会话
            </button>
          </div>
          <div className="shrink-0 px-3 pb-3 pt-[15px]">
            <strong className="flex items-center gap-1.5 text-[11px] font-semibold text-[#344054]">
              <Icon icon={Folder} size="sm" />
              {projectLabel}
            </strong>
            <small className="mt-1.5 block font-mono text-[9px] leading-[1.6] text-[#667085]">
              {tab === "files" ? cwd : "/workspace · personal"}
            </small>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
            {tab === "files" ? (
              <>
                {findOn ? (
                  <form
                    className="mb-2 flex gap-1 px-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void onFind();
                    }}
                  >
                    <input
                      className="min-w-0 flex-1 rounded border border-[#e1e6ee] px-2 py-1 text-[10px]"
                      value={findQuery}
                      placeholder="查找文件"
                      onChange={(event) => setFindQuery(event.target.value)}
                    />
                  </form>
                ) : null}
                {cwd !== "/" ? (
                  <button
                    type="button"
                    className="block w-full cursor-pointer rounded-[5px] border-0 bg-transparent p-[9px] text-left text-[10px] text-[#667085] hover:bg-[#eef1f6]"
                    onClick={() => void openPath(parentAgentPath(cwd), "directory")}
                  >
                    ..
                  </button>
                ) : null}
                {entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    className="block w-full cursor-pointer rounded-[5px] border-0 bg-transparent p-[9px] text-left hover:bg-[#eef1f6]"
                    onClick={() => void openPath(entry.path, entry.kind)}
                  >
                    <strong className="block text-[10px] font-[550] text-[#344054]">{entry.name}</strong>
                    <small className="mt-[3px] block text-[9px] text-[#9aa79d]">
                      {entry.zone === "common" ? "公共资料 · 只读" : "个人区"}
                      {entry.kind === "directory" ? " · 目录" : ""}
                    </small>
                  </button>
                ))}
              </>
            ) : (
              <>
                {sessions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "mb-0.5 block w-full cursor-pointer rounded-[5px] border-0 bg-transparent px-[9px] py-3 text-left text-[10px] leading-[1.7] text-[#667085] hover:bg-[#eef1f6]",
                      item.id === sessionId && "bg-ah-accent-soft text-ah-accent",
                    )}
                    onClick={() => selectSession(item.id)}
                  >
                    {item.title}
                    <br />
                    <span className={cn("text-[9px] text-[#a0aaa1]", item.id === sessionId && "text-[#7d93e7]")}>
                      {item.runtimeType} · {item.status}
                      {item.issue ? ` · ${item.issue.key}` : ""}
                    </span>
                  </button>
                ))}
                {sessions.length === 0 ? (
                  <p className="m-2 text-[9px] leading-[1.8] text-[#667085]">尚无会话。先选择凭据，再新建会话。</p>
                ) : null}
              </>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-ah-line max-[1200px]:border-r-0">
          <div className="flex min-h-[43px] shrink-0 flex-wrap items-center gap-[9px] border-b border-ah-line p-3 text-[10px] text-[#344054]">
            <span className={ui.engineLogo}>
              <Icon icon={Command} size="sm" />
            </span>
            {renaming ? (
              <input
                className="min-w-0 flex-1 rounded border border-[#e1e6ee] px-2 py-1 text-[11px]"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
              />
            ) : (
              <span>{active?.title ?? "选择或新建会话"}</span>
            )}
            {active ? (
              <Badge tone={active.status === "busy" || active.status === "idle" ? "green" : active.status === "failed" ? "red" : "default"}>
                {active.status}
              </Badge>
            ) : null}
            <Select
              aria-label="会话凭据"
              className="ml-auto max-w-[180px]"
              value={credentialValue}
              disabled={locked || busy}
              title={locked ? "会话忙碌时不能切换凭据" : "新建会话使用的凭据"}
              onChange={(event) => setCredentialValue(event.target.value)}
            >
              <option value="">选择凭据</option>
              {(options?.options ?? []).map((item) => (
                <option key={credentialKey(item.source, item.id)} value={credentialKey(item.source, item.id)}>
                  {item.source === "project" ? "项目" : "个人"} · {item.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap gap-2 border-b border-[#eef1ed] px-3 py-2">
            {renaming ? (
              <Button size="sm" disabled={busy} onClick={() => void onRename()}>
                保存标题
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={!active || busy}
                onClick={() => {
                  setTitleDraft(active?.title ?? "");
                  setRenaming(true);
                }}
              >
                重命名
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={!active || busy || active.status === "busy"} onClick={() => void onArchive()}>
              归档
            </Button>
            {showsAbort(workspace?.capabilities) && active?.status === "busy" ? (
              <Button size="sm" variant="danger" disabled={busy} onClick={() => void onAbort()}>
                停止
              </Button>
            ) : null}
            {active?.issue ? (
              <span className={ui.badge}>关联 {active.issue.key}</span>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-[18px]">
            {!sessionId ? (
              <div className="px-3 py-10 text-center text-[11px] leading-[1.8] text-[#667085]">
                选择凭据并创建个人会话后，在此与 Agent 对话。消息经 Hub Facade 流式投递。
              </div>
            ) : (
              lines.map((line) => <ChatBubble key={line.id} line={line} />)
            )}
            <div ref={bottomRef} />
          </div>

          <form
            className="mx-3 mb-3 shrink-0 rounded-lg border border-[#d0d5dd] p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onSend();
            }}
          >
            <textarea
              className="max-h-[18dvh] min-h-10 w-full resize-none border-0 bg-transparent text-[11px] text-[#475467] outline-none"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={sessionId ? "描述任务，或从工作区引用文件…" : "请先创建会话"}
              disabled={!sessionId || busy}
              rows={2}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px] text-[#667085]">
              <span>
                {active ? `${active.runtimeType} · ${active.credential.label}` : "先选择凭据再新建会话"}
                {locked ? " · 忙碌时不可切换凭据" : ""}
              </span>
              <Button type="submit" size="sm" disabled={!sessionId || busy || !draft.trim()}>
                <Icon icon={Send} size="sm" />
                发送
              </Button>
            </div>
          </form>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden bg-[#fbfcfd]" aria-label="工作空间文件预览">
          <div className="flex min-h-[42px] shrink-0 items-center border-b border-ah-line px-3">
            <span className="text-[10px] text-[#98a2b3]">文件预览</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef1ed] px-3.5 py-2.5 font-mono text-[9px] leading-[1.5] text-[#667085]">
            <span>{preview?.path ?? "/workspace"}</span>
            <span className={ui.badge}>{preview?.zone === "common" ? "公共资料 · 只读" : "个人工作区"}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3.5 py-4 text-[10px] leading-[1.8] text-[#475467]">
            {preview ? (
              <pre className="m-0 whitespace-pre-wrap font-mono">
                {preview.text ?? "此文件不能按文本预览。"}
              </pre>
            ) : (
              <p className="m-0 text-[#9aa79d]">
                {filesOn ? "在左侧打开文件后，这里显示只读文本。" : "当前运行实例没有文件能力，文件树已隐藏。"}
              </p>
            )}
            {terminalOn ? (
              <p className="mt-4 flex items-center gap-1 text-[#667085]">
                <Icon icon={Terminal} size="sm" />
                终端能力已开启。完整终端不在本阶段。
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      {permission && showsPermissions(workspace?.capabilities) ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[#10182866] p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="权限确认"
            className={cn(ui.surface, "w-full max-w-[480px] p-0 shadow-[0_16px_48px_#1018282e]")}
          >
            <div className="border-b border-ah-line px-5 py-4">
              <h2 className="m-0 text-sm font-semibold text-[#182230]">Agent 请求权限</h2>
            </div>
            <div className="px-5 py-4 text-[11px] leading-[1.7] text-[#667085]">
              <p className="m-0">
                工具 <strong className="text-[#344054]">{permission.tool}</strong> 需要你确认后才能继续。
              </p>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[#f8fafc] p-2 font-mono text-[10px] text-[#344054]">
                {typeof permission.input === "string"
                  ? permission.input
                  : JSON.stringify(permission.input, null, 2)}
              </pre>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ah-line px-5 py-3.5">
              {permission.options.includes("deny") ? (
                <Button variant="danger" onClick={() => void onDecision("deny")}>
                  拒绝
                </Button>
              ) : null}
              {permission.options.includes("always") ? (
                <Button variant="secondary" onClick={() => void onDecision("always")}>
                  始终允许
                </Button>
              ) : null}
              {permission.options.includes("allow") ? (
                <Button onClick={() => void onDecision("allow")}>允许</Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChatBubble({ line }: { line: ChatLine }) {
  if (line.role === "tool") {
    return (
      <div className="mb-4 rounded-md border border-[#e1e6ee] bg-[#f8fafc] px-3 py-2 text-[10px] text-[#475467]">
        <div className="mb-1 font-semibold text-[#344054]">
          {line.toolName ?? "tool"}
          {line.toolPending ? " · 执行中" : line.toolError ? " · 失败" : " · 完成"}
        </div>
        <pre className="m-0 whitespace-pre-wrap font-mono">{line.text}</pre>
      </div>
    );
  }
  return (
    <div className="mb-5 text-[11px] leading-[1.9] text-[#667085]">
      <div className="mb-2 flex items-center gap-[7px] text-[10px] font-semibold text-[#344054]">
        {line.role === "user" ? (
          <>
            <Avatar tone="green" size="sm">
              你
            </Avatar>{" "}
            你
          </>
        ) : line.role === "assistant" ? (
          <>
            <span className={ui.engineLogo}>
              <Icon icon={Command} size="sm" />
            </span>{" "}
            Agent
          </>
        ) : (
          <>系统</>
        )}
      </div>
      <div
        className={cn(
          "overflow-wrap-anywhere whitespace-pre-wrap",
          line.role === "user" && "inline-block max-w-[85%] rounded-lg bg-ah-accent px-3 py-2.5 text-white",
          line.role === "assistant" && "text-[#475467]",
          line.role === "system" && "rounded-md bg-[#fffaeb] px-2.5 py-2 text-[#b54708]",
        )}
      >
        {line.text}
      </div>
    </div>
  );
}

async function readError(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: Response }).response;
    if (response) {
      try {
        const body = (await response.clone().json()) as { error?: { message?: string } };
        if (body.error?.message) return body.error.message;
      } catch {
        /* ignore */
      }
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
