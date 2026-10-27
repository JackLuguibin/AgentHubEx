import { useEffect, useRef, useState } from "react";
import type { AgentSession, CredentialOptionsRes, Workspace } from "@agenthub/domain";
import type { FacadeClient } from "@agenthub/agent-client";
import {
  Avatar,
  Badge,
  Button,
  Icon,
  Select,
  cn,
  ui,
} from "@agenthub/hub-ui-kit";
import { Command, Folder, MoreHorizontal, PanelLeft, PanelRight, Plus, RefreshCw, Send } from "lucide-react";
import { CodePane } from "./CodePane.js";
import { MarkdownText } from "./MarkdownText.js";
import { TerminalPane } from "./TerminalPane.js";
import {
  agentFileContentRequest,
  agentFileRequest,
  agentFindRequest,
  applyEnvelope,
  canEditFile,
  closeEditorTab,
  credentialKey,
  credentialSwitchLocked,
  extractText,
  normalizeAgentFile,
  parentAgentPath,
  parseCredentialKey,
  sessionChangedPaths,
  showsAbort,
  showsFiles,
  showsFind,
  showsPermissions,
  showsTerminal,
  toolPresentation,
  upsertEditorTab,
  type AgentFileNode,
  type ChatLine,
  type DiffLine,
  type EditorMode,
  type EditorTab,
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
  const [mobilePane, setMobilePane] = useState<"sessions" | "chat" | "files">("chat");
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(true);
  const [fileTab, setFileTab] = useState<"changes" | "all">("all");
  const [mentionHits, setMentionHits] = useState<AgentFileNode[]>([]);
  const [options, setOptions] = useState<CredentialOptionsRes | null>(null);
  const [credentialValue, setCredentialValue] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [permission, setPermission] = useState<PermissionAsk | null>(null);
  const [cwd, setCwd] = useState("/");
  const [entries, setEntries] = useState<AgentFileNode[]>([]);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("code");
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
  const changedPaths = sessionChangedPaths(lines, tabs);
  const mentionQuery = /@([^\s]*)$/.exec(draft)?.[1] ?? null;
  const mentionChoices = mentionOptions(mentionQuery, entries, tabs, mentionHits);

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
    setTabs([]);
    setActivePath(null);
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

  useEffect(() => {
    if (!findOn || !workspace?.id || mentionQuery == null || mentionQuery.length < 2) {
      setMentionHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void client
        .agentGet(workspace.id, agentFindRequest(mentionQuery))
        .then((body) => {
          const normalized = normalizeAgentFile(body, "/");
          setMentionHits(normalized.kind === "directory" ? normalized.entries : []);
        })
        .catch(() => setMentionHits([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [mentionQuery, findOn, workspace?.id, client]);

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
        return;
      }
      const content = await client.agentGet(workspace.id, agentFileContentRequest(normalized.path));
      const file = normalizeAgentFile(content, normalized.path);
      if (file.kind !== "file") return;
      const tab: EditorTab = {
        path: file.path,
        original: file.text ?? "",
        draft: file.text ?? "",
        zone: file.zone,
        editable: canEditFile(file.zone, file.text),
      };
      setTabs((current) => upsertEditorTab(current, tab));
      setActivePath(tab.path);
      setEditorMode("code");
      setFilesOpen(true);
      setMobilePane("files");
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
        runtimeType: workspace?.runtimeType,
        credentialSource: picked.source,
        credentialId: picked.id,
      });
      await refreshSessions();
      selectSession(session.id);
      setMobilePane("chat");
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

  const onSaveFile = async (path: string) => {
    const tab = tabs.find((item) => item.path === path);
    if (!workspace?.id || !tab?.editable) return;
    setBusy(true);
    setError(null);
    try {
      await client.agentPut(workspace.id, agentFileContentRequest(path), { content: tab.draft });
      setTabs((current) =>
        current.map((item) => (item.path === path ? { ...item, original: item.draft } : item)),
      );
      setNotice("已保存到个人工作区");
    } catch (err: unknown) {
      setError(await readError(err, "保存失败"));
    } finally {
      setBusy(false);
    }
  };

  const insertMention = (path: string) => {
    const ref = path.startsWith("/") ? path : `/${path}`;
    setDraft((current) => current.replace(/@([^\s]*)$/, `@${ref} `));
    setMobilePane("chat");
  };

  const onAttachFile = (path: string) => {
    setDraft((current) => `${current}${current ? "\n" : ""}@${path.startsWith("/") ? path : `/${path}`} `);
    setMobilePane("chat");
  };

  const onCopyPath = async (path: string) => {
    const text = path.startsWith("/") ? path : `/${path}`;
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`已复制 ${text}`);
    } catch {
      setNotice(text);
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

  const permissionLineId = permissionAnchor(lines, permission);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="flex gap-1 border-b border-ah-line p-2 min-[1100px]:hidden" role="tablist" aria-label="工作台面板">
        {(
          [
            ["sessions", "会话"],
            ["chat", "对话"],
            ["files", "文件"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mobilePane === id}
            disabled={id === "files" && !filesOn}
            className={cn(
              "flex-1 cursor-pointer rounded-md border border-[#e1e6ee] bg-[#eef1f6] px-2 py-2 text-xs text-[#667085] disabled:cursor-not-allowed disabled:opacity-40",
              mobilePane === id && "border-[#c9d4f5] bg-white font-medium text-ah-accent",
            )}
            onClick={() => {
              setMobilePane(id);
              if (id === "files") setFilesOpen(true);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "flex min-h-0 w-full min-w-0 flex-col border-r border-ah-line bg-[#fafbfc] min-[1100px]:w-56 min-[1100px]:shrink-0",
            !sessionsOpen && "min-[1100px]:hidden",
            mobilePane !== "sessions" && "max-[1099px]:hidden",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-ah-line px-3 py-3">
            <strong className="truncate text-sm text-[#344054]">{projectLabel}</strong>
            <Button size="sm" disabled={busy || !credentialValue} onClick={() => void onCreate()}>
              <Icon icon={Plus} size="sm" />
              新建
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {sessions.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "mb-1 block w-full cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-2.5 text-left hover:bg-[#eef1f6]",
                  item.id === sessionId && "bg-ah-accent-soft",
                )}
                onClick={() => {
                  selectSession(item.id);
                  setMobilePane("chat");
                }}
              >
                <span className={cn("block truncate text-sm text-[#344054]", item.id === sessionId && "text-ah-accent")}>
                  {item.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-[#667085]">
                  {item.runtimeType} · {item.status}
                  {item.issue ? ` · ${item.issue.key}` : ""}
                </span>
              </button>
            ))}
            {sessions.length === 0 ? (
              <p className="m-2 text-sm leading-6 text-[#667085]">还没有会话。选好下方凭据后点新建。</p>
            ) : null}
          </div>
        </aside>

        <section
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            mobilePane !== "chat" && "max-[1099px]:hidden",
          )}
        >
          <div className="relative flex h-12 shrink-0 items-center gap-2 border-b border-ah-line px-3">
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={sessionsOpen}
              aria-label={sessionsOpen ? "收起会话" : "展开会话"}
              title={sessionsOpen ? "收起会话" : "展开会话"}
              onClick={() => {
                if (window.matchMedia("(max-width: 1099px)").matches) {
                  setSessionsOpen(true);
                  setMobilePane("sessions");
                  return;
                }
                setSessionsOpen((value) => !value);
              }}
            >
              <Icon icon={PanelLeft} size="sm" />
            </Button>
            <span className={ui.engineLogo}>
              <Icon icon={Command} size="sm" />
            </span>
            {renaming ? (
              <>
                <input
                  className="min-w-0 flex-1 rounded border border-[#e1e6ee] px-2 py-1 text-sm"
                  value={titleDraft}
                  aria-label="会话标题"
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void onRename();
                  }}
                />
                <Button size="sm" disabled={busy} onClick={() => void onRename()}>
                  保存
                </Button>
              </>
            ) : (
              <span className="max-w-[14rem] min-w-[4rem] truncate text-sm font-medium text-[#182230]">
                {active?.title ?? "选择或新建会话"}
              </span>
            )}
            {active ? (
              <Badge tone={active.status === "busy" || active.status === "idle" ? "green" : active.status === "failed" ? "red" : "default"}>
                {active.status}
              </Badge>
            ) : null}
            {active?.issue ? <span className={ui.badge}>关联 {active.issue.key}</span> : null}
            <span className="shrink-0 text-xs text-[#667085]">
              {streamStatus === "live" ? "已连接" : streamStatus === "error" ? "已断开" : "待命"}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={menuOpen}
                aria-label="更多操作"
                onClick={() => setMenuOpen((value) => !value)}
              >
                <Icon icon={MoreHorizontal} size="sm" />
              </Button>
              {filesOn ? (
                <Button
                  size="sm"
                  variant={filesOpen ? "secondary" : "ghost"}
                  aria-pressed={filesOpen}
                  onClick={() => {
                    setFilesOpen((value) => !value);
                    setMobilePane("files");
                  }}
                >
                  <Icon icon={PanelRight} size="sm" />
                  文件
                </Button>
              ) : null}
            </div>
            {menuOpen ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-20 cursor-default border-0 bg-transparent"
                  aria-label="关闭菜单"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute top-11 right-3 z-30 grid min-w-36 gap-1 rounded-md border border-ah-line bg-white p-1.5 shadow-[0_8px_24px_#10182814] [&>button]:w-full [&>button]:justify-start">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !credentialValue}
                    onClick={() => {
                      setMenuOpen(false);
                      void onCreate();
                    }}
                  >
                    <Icon icon={Plus} size="sm" />
                    新建会话
                  </Button>
                  {renaming ? (
                    <Button size="sm" disabled={busy} onClick={() => void onRename()}>
                      保存标题
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!active || busy}
                      onClick={() => {
                        setTitleDraft(active?.title ?? "");
                        setRenaming(true);
                        setMenuOpen(false);
                      }}
                    >
                      重命名
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!active || busy || active.status === "busy"}
                    onClick={() => {
                      setMenuOpen(false);
                      void onArchive();
                    }}
                  >
                    归档
                  </Button>
                  {showsAbort(workspace?.capabilities) && active?.status === "busy" ? (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        setMenuOpen(false);
                        void onAbort();
                      }}
                    >
                      停止
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !workspace?.id}
                    onClick={() => {
                      setMenuOpen(false);
                      void onSyncConfig();
                    }}
                  >
                    <Icon icon={RefreshCw} size="sm" />
                    同步配置
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !workspace?.id}
                    onClick={() => {
                      setMenuOpen(false);
                      void onSyncCommon();
                    }}
                  >
                    同步公共资料
                  </Button>
                </div>
              </>
            ) : null}
          </div>

          {error ? <p className="m-0 border-b border-[#fecdca] bg-[#fef3f2] px-4 py-2 text-sm text-[#b42318]">{error}</p> : null}
          {notice ? <p className="m-0 border-b border-[#abefc6] bg-[#ecfdf3] px-4 py-2 text-sm text-[#067647]">{notice}</p> : null}

          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            {!sessionId ? (
              <div className="px-3 py-16 text-center text-sm leading-7 text-[#667085]">
                在左侧新建会话后，在这里跟 Agent 对话。
              </div>
            ) : (
              lines.map((line) => (
                <ChatBubble
                  key={line.id}
                  line={line}
                  permission={line.id === permissionLineId ? permission : null}
                  onDecision={(decision) => void onDecision(decision)}
                />
              ))
            )}
            {permission && showsPermissions(workspace?.capabilities) && permissionLineId == null ? (
              <PermissionCard ask={permission} onDecision={(decision) => void onDecision(decision)} />
            ) : null}
            <div ref={bottomRef} />
          </div>

          <form
            className="shrink-0 border-t border-ah-line px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onSend();
            }}
          >
            {mentionChoices.length > 0 ? (
              <div className="mb-2 max-h-40 overflow-auto rounded-md border border-[#e1e6ee] bg-white" role="listbox" aria-label="引用文件">
                {mentionChoices.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    className="block w-full cursor-pointer border-0 bg-transparent px-3 py-2 text-left text-sm hover:bg-[#eef1f6]"
                    onClick={() => insertMention(item.path)}
                  >
                    <span className="font-mono text-[#344054]">{item.path}</span>
                    <span className="ml-2 text-xs text-[#667085]">{item.zone === "common" ? "公共资料" : "个人区"}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <textarea
              className="max-h-[24dvh] min-h-16 w-full resize-none border-0 bg-transparent text-sm leading-6 text-[#182230] outline-none"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={sessionId ? "输入任务，@ 引用文件。Enter 发送，Shift+Enter 换行。" : "请先创建会话"}
              disabled={!sessionId || busy}
              rows={3}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if (mentionQuery != null && mentionChoices[0]) {
                  insertMention(mentionChoices[0].path);
                  return;
                }
                void onSend();
              }}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select
                aria-label="会话凭据"
                className="max-w-[220px]"
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
              <span className="text-xs text-[#667085]">
                {active ? `${active.runtimeType} · ${active.credential.label}` : workspace?.runtimeType ?? "先选择凭据"}
                {locked ? " · 忙碌时不可切换凭据" : ""}
              </span>
              <Button className="ml-auto" type="submit" size="sm" disabled={!sessionId || busy || !draft.trim()}>
                <Icon icon={Send} size="sm" />
                发送
              </Button>
            </div>
          </form>
        </section>

        {filesOn && filesOpen ? (
          <aside
            className={cn(
              "flex min-h-0 w-full min-w-0 shrink flex-col border-l border-ah-line bg-[#fbfcfd]",
              activePath ? "min-[1100px]:w-[min(28rem,42%)]" : "min-[1100px]:w-72 min-[1100px]:shrink-0",
              mobilePane !== "files" && "max-[1099px]:hidden",
            )}
          >
            <div className="flex h-11 shrink-0 items-center gap-3 border-b border-ah-line px-3">
              {(
                [
                  ["changes", "本次改动"],
                  ["all", "全部文件"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    "cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-0.5 py-2 text-sm text-[#667085]",
                    fileTab === id && "border-ah-accent font-medium text-ah-accent",
                  )}
                  onClick={() => setFileTab(id)}
                >
                  {label}
                  {id === "changes" && changedPaths.length > 0 ? ` ${changedPaths.length}` : ""}
                </button>
              ))}
              <button
                type="button"
                className="ml-auto cursor-pointer border-0 bg-transparent px-1 text-lg leading-none text-[#98a2b3]"
                aria-label="关闭文件栏"
                onClick={() => setFilesOpen(false)}
              >
                ×
              </button>
            </div>
            <div className={cn("min-h-0 overflow-auto", activePath ? "max-h-36 shrink-0" : "flex-1")}>
              {fileTab === "changes" ? (
                <div className="p-2">
                  {changedPaths.length === 0 ? (
                    <p className="m-2 text-sm leading-6 text-[#667085]">这次会话还没有改动文件。</p>
                  ) : (
                    changedPaths.map((path) => (
                      <button
                        key={path}
                        type="button"
                        className="block w-full cursor-pointer rounded-md border-0 bg-transparent px-2 py-2 text-left hover:bg-[#eef1f6]"
                        onClick={() => void openPath(path, "file")}
                      >
                        <span className="block truncate font-mono text-sm text-[#344054]">{path.split("/").pop()}</span>
                        <span className="mt-0.5 block truncate font-mono text-xs text-[#667085]">{path}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className="p-2">
                  <div className="mb-2 flex items-center gap-1 px-1 text-xs text-[#667085]">
                    <Icon icon={Folder} size="sm" />
                    <span className="truncate font-mono">{cwd}</span>
                  </div>
                  {findOn ? (
                    <form
                      className="mb-2 flex gap-1 px-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void onFind();
                      }}
                    >
                      <input
                        className="min-w-0 flex-1 rounded border border-[#e1e6ee] px-2 py-1.5 text-sm"
                        value={findQuery}
                        placeholder="查找文件"
                        aria-label="查找文件"
                        onChange={(event) => setFindQuery(event.target.value)}
                      />
                    </form>
                  ) : null}
                  {cwd !== "/" ? (
                    <button
                      type="button"
                      className="block w-full cursor-pointer rounded-md border-0 bg-transparent px-2 py-2 text-left text-sm text-[#667085] hover:bg-[#eef1f6]"
                      onClick={() => void openPath(parentAgentPath(cwd), "directory")}
                    >
                      ..
                    </button>
                  ) : null}
                  {entries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      className="block w-full cursor-pointer rounded-md border-0 bg-transparent px-2 py-2 text-left hover:bg-[#eef1f6]"
                      onClick={() => void openPath(entry.path, entry.kind)}
                    >
                      <span className="block truncate text-sm text-[#344054]">{entry.name}</span>
                      <span className="mt-0.5 block text-xs text-[#667085]">
                        {entry.zone === "common" ? "公共资料 · 只读" : "个人区"}
                        {entry.kind === "directory" ? " · 目录" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {activePath ? (
              <CodePane
                filesOn={filesOn}
                tabs={tabs}
                activePath={activePath}
                mode={editorMode}
                busy={busy}
                onMode={setEditorMode}
                onSelect={setActivePath}
                onClose={(path) => {
                  const next = closeEditorTab(tabs, path, activePath);
                  setTabs(next.tabs);
                  setActivePath(next.active);
                }}
                onChange={(path, nextDraft) => {
                  setTabs((current) =>
                    current.map((item) => (item.path === path && item.editable ? { ...item, draft: nextDraft } : item)),
                  );
                }}
                onSave={(path) => void onSaveFile(path)}
                onAttach={onAttachFile}
                onCopy={(path) => void onCopyPath(path)}
              />
            ) : null}
          </aside>
        ) : null}
      </div>

      {terminalOn && workspace?.id ? (
        <TerminalPane client={client} workspaceId={workspace.id} apiBase={apiBase} />
      ) : null}
    </div>
  );
}

function permissionAnchor(lines: ChatLine[], permission: PermissionAsk | null) {
  if (!permission) return null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (line.role === "tool" && line.toolName === permission.tool) return line.id;
  }
  return null;
}

function mentionOptions(
  query: string | null,
  entries: AgentFileNode[],
  tabs: EditorTab[],
  hits: AgentFileNode[],
) {
  if (query == null) return [];
  const needle = query.toLowerCase();
  const local: AgentFileNode[] = [
    ...entries.filter((entry) => entry.kind === "file"),
    ...tabs.map((tab) => ({
      name: tab.path.split("/").filter(Boolean).pop() ?? tab.path,
      path: tab.path,
      kind: "file" as const,
      zone: tab.zone,
    })),
    ...hits.filter((entry) => entry.kind === "file"),
  ];
  const seen = new Set<string>();
  const matched: AgentFileNode[] = [];
  for (const item of local) {
    if (seen.has(item.path)) continue;
    if (needle && !item.path.toLowerCase().includes(needle) && !item.name.toLowerCase().includes(needle)) continue;
    seen.add(item.path);
    matched.push(item);
    if (matched.length === 8) break;
  }
  return matched;
}

function ChatBubble({
  line,
  permission,
  onDecision,
}: {
  line: ChatLine;
  permission: PermissionAsk | null;
  onDecision: (decision: "allow" | "deny" | "always") => void;
}) {
  if (line.role === "tool") {
    const view = toolPresentation(line);
    return (
        <div className="mb-4 min-w-0">
        <div className="min-w-0 rounded-md border border-[#e1e6ee] bg-[#f8fafc] px-3 py-2 text-sm text-[#475467]">
          <div className="mb-1 font-medium text-[#344054]">
            {line.toolName ?? "tool"}
            {line.toolPending ? " · 执行中" : line.toolError ? " · 失败" : " · 完成"}
          </div>
          {view.summary ? <div className="break-all whitespace-pre-wrap font-mono text-[13px] leading-6">{view.summary}</div> : null}
          {view.diff && view.diff.length > 0 ? <DiffBlock lines={view.diff} /> : null}
          {view.output ? (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[13px] leading-6">{view.output}</pre>
          ) : null}
        </div>
        {permission ? <PermissionCard ask={permission} onDecision={onDecision} /> : null}
      </div>
    );
  }
  return (
    <div className="mb-5 text-sm leading-7 text-[#344054]">
      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[#344054]">
        {line.role === "user" ? (
          <>
            <Avatar tone="green" size="sm">
              你
            </Avatar>
            你
          </>
        ) : line.role === "assistant" ? (
          <>
            <span className={ui.engineLogo}>
              <Icon icon={Command} size="sm" />
            </span>
            Agent
          </>
        ) : (
          <>系统</>
        )}
      </div>
      {line.role === "assistant" ? (
        <MarkdownText text={line.text} />
      ) : (
        <div
          className={cn(
            "break-words whitespace-pre-wrap",
            line.role === "user" && "inline-block max-w-[85%] rounded-lg bg-ah-accent px-3 py-2 text-white",
            line.role === "system" && "rounded-md bg-[#fffaeb] px-2.5 py-2 text-[#b54708]",
          )}
        >
          {line.text}
        </div>
      )}
    </div>
  );
}

function PermissionCard({
  ask,
  onDecision,
}: {
  ask: PermissionAsk;
  onDecision: (decision: "allow" | "deny" | "always") => void;
}) {
  return (
    <div className="mt-2 rounded-md border border-[#f5d9a8] bg-[#fffaeb] px-3 py-3" role="group" aria-label="权限确认">
      <p className="m-0 text-sm text-[#344054]">
        工具 <strong>{ask.tool}</strong> 需要确认后才能继续。
      </p>
      <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap font-mono text-[13px] leading-6 text-[#344054]">
        {typeof ask.input === "string" ? ask.input : JSON.stringify(ask.input, null, 2)}
      </pre>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {ask.options.includes("deny") ? (
          <Button variant="danger" size="sm" onClick={() => onDecision("deny")}>
            拒绝
          </Button>
        ) : null}
        {ask.options.includes("always") ? (
          <Button variant="secondary" size="sm" onClick={() => onDecision("always")}>
            始终允许
          </Button>
        ) : null}
        {ask.options.includes("allow") ? (
          <Button size="sm" onClick={() => onDecision("allow")}>
            允许
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DiffBlock({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="mt-2 overflow-auto rounded bg-white font-mono text-[13px] leading-6">
      {lines.map((line, index) => (
        <div
          key={`${line.kind}-${index}`}
          className={cn(
            "whitespace-pre-wrap px-2",
            line.kind === "add" && "bg-[#ecfdf3] text-[#067647]",
            line.kind === "del" && "bg-[#fef3f2] text-[#b42318]",
          )}
        >
          {line.kind === "add" ? "+ " : "- "}
          {line.text || " "}
        </div>
      ))}
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
