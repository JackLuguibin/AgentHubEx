import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AgentSession } from "@agenthub/domain";
import type { FacadeClient } from "@agenthub/agent-client";
import type { Envelope } from "@agenthub/runtime-contract";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Icon,
  PageHeader,
  cn,
  ui,
} from "@agenthub/hub-ui-kit";
import { Command, Folder, Plus, Send } from "lucide-react";

type ChatLine = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};

export type WorkbenchProps = {
  projectId: string;
  projectLabel?: string;
  client: FacadeClient;
  getAccessToken: () => string | null;
  apiBase: string;
  initialSessionId?: string | null;
  onSessionChange?: (sessionId: string | null) => void;
};

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
  const [error, setError] = useState<string | null>(null);
  const [explorerTab, setExplorerTab] = useState<"sessions" | "files">("sessions");
  const [mobilePane, setMobilePane] = useState<"files" | "chat" | "code">("chat");
  const lastEventId = useRef<string | undefined>(undefined);
  const assistantBuf = useRef<Map<string, string>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = sessions.find((s) => s.id === sessionId) ?? null;
  const fileTree = [
    { path: "AGENTS.md", hint: "项目指令" },
    { path: "src/main.ts", hint: "工作区文件" },
    { path: "project-common/docs/architecture.md", hint: "只读 · 公共" },
  ];

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
    void refreshSessions()
      .then((items) => {
        setSessionId((current) => {
          if (current) return current;
          const next = items[0]?.id ?? null;
          if (next) onSessionChange?.(next);
          return next;
        });
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "加载会话失败"),
      );
  }, [projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    if (!sessionId) {
      setLines([]);
      setStreamStatus("idle");
      return;
    }

    const ac = new AbortController();
    setLines([]);
    assistantBuf.current.clear();
    lastEventId.current = undefined;
    setStreamStatus("idle");

    void (async () => {
      try {
        const history = await client.listMessages(sessionId);
        setLines(
          history.items.map((m) => ({
            id: m.id,
            role: m.role,
            text: extractText(m.parts),
          })),
        );
      } catch {
        /* empty */
      }

      try {
        await client.subscribeSessionEvents(sessionId, {
          baseUrl: apiBase,
          getAccessToken,
          signal: ac.signal,
          lastEventId: lastEventId.current,
          onOpen: () => setStreamStatus("live"),
          onEvent: (envelope) => {
            lastEventId.current = String(envelope.seq);
            applyEnvelope(envelope, setLines, assistantBuf.current);
          },
          onError: () => setStreamStatus("error"),
        });
      } catch {
        if (!ac.signal.aborted) setStreamStatus("error");
      }
    })();

    return () => ac.abort();
  }, [sessionId, apiBase, client, getAccessToken]);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await client.createSession(projectId, { title: "新会话" });
      await refreshSessions();
      selectSession(session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建会话失败");
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
    const localId = `local-${Date.now()}`;
    setLines((prev) => [...prev, { id: localId, role: "user", text }]);
    try {
      await client.sendMessage(sessionId, {
        parts: [{ type: "text", text }],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
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
            <Button variant="secondary" disabled title="P1">
              同步配置
            </Button>
            <Button disabled={busy} onClick={() => void onCreate()}>
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
              {streamStatus === "live"
                ? "SSE live"
                : streamStatus === "error"
                  ? "已断开"
                  : "待命"}
            </Badge>
            <span className={ui.badge}>React Workbench · Hub Facade</span>
          </span>
        }
      >
        /workspace · {projectLabel} · Hub 连接
        {streamStatus === "live" ? " · 实时已连接" : ""}
        {" · 公共空间只读"}
      </Banner>

      {error ? <p className="text-[11px] text-[#b42318]">{error}</p> : null}

      <div
        className="mb-0 flex gap-1 max-[680px]:flex min-[681px]:hidden"
        role="tablist"
        aria-label="工作台面板"
      >
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
              if (id === "files") setExplorerTab("files");
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
            {(
              [
                ["files", "文件"],
                ["sessions", "会话"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={cn(
                  "cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-0.5 text-[11px] text-[#667085]",
                  explorerTab === id && "border-ah-accent font-semibold text-ah-accent",
                )}
                onClick={() => setExplorerTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="shrink-0 px-3 pb-3 pt-[15px]">
            <strong className="flex items-center gap-1.5 text-[11px] font-semibold text-[#344054]">
              <Icon icon={Folder} size="sm" />
              {projectLabel}
            </strong>
            <small className="mt-1.5 block font-mono text-[9px] leading-[1.6] text-[#667085]">
              /workspace · personal
            </small>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
            {explorerTab === "files" ? (
              <>
                <div className="flex flex-col gap-0.5 px-0.5" aria-label="工作空间文件">
                  {fileTree.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      className="block w-full cursor-pointer rounded-[5px] border-0 bg-transparent p-[9px] text-left hover:bg-[#eef1f6]"
                    >
                      <strong className="block text-[10px] font-[550] text-[#344054]">
                        {f.path.split("/").pop()}
                      </strong>
                      <small className="mt-[3px] block overflow-wrap-anywhere text-[9px] text-[#9aa79d]">
                        {f.path} · {f.hint}
                      </small>
                    </button>
                  ))}
                </div>
                <p className="m-2 text-[9px] leading-[1.8] text-[#667085]">
                  个人工作区 · 示例文件
                  <br />
                  project-common 为只读公共资料
                </p>
              </>
            ) : (
              <>
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={cn(
                      "mb-0.5 block w-full cursor-pointer rounded-[5px] border-0 bg-transparent px-[9px] py-3 text-left text-[10px] leading-[1.7] text-[#667085] hover:bg-[#eef1f6]",
                      s.id === sessionId && "bg-ah-accent-soft text-ah-accent",
                    )}
                    onClick={() => selectSession(s.id)}
                  >
                    {s.title}
                    <br />
                    <span
                      className={cn(
                        "text-[9px] text-[#a0aaa1]",
                        s.id === sessionId && "text-[#7d93e7]",
                      )}
                    >
                      {s.runtimeType} · {s.status}
                    </span>
                  </button>
                ))}
                {sessions.length === 0 ? (
                  <p className="m-2 text-[9px] leading-[1.8] text-[#667085]">
                    尚无会话，点击「新建会话」开始。
                  </p>
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
            <span>{active?.title ?? "选择或新建会话"}</span>
            {active ? (
              <Badge
                tone={
                  active.status === "busy" || active.status === "idle"
                    ? "green"
                    : active.status === "failed"
                      ? "red"
                      : "default"
                }
              >
                {active.status}
              </Badge>
            ) : null}
            {active ? (
              <span className={cn(ui.badge, "ml-auto")}>{active.credential.label}</span>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-[18px]">
            {!sessionId ? (
              <div className="px-3 py-10 text-center text-[11px] leading-[1.8] text-[#667085]">
                创建个人会话后，在此与 Agent 对话。消息经 Hub Facade 流式投递。
              </div>
            ) : (
              lines.map((line) => (
                <div
                  key={line.id}
                  className="mb-5 text-[11px] leading-[1.9] text-[#667085]"
                >
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
                        OpenCode
                        <span className="font-normal text-[#667085]">Build Agent</span>
                      </>
                    ) : (
                      <>系统</>
                    )}
                  </div>
                  <div
                    className={cn(
                      "overflow-wrap-anywhere whitespace-pre-wrap",
                      line.role === "user" &&
                        "inline-block max-w-[85%] rounded-lg bg-ah-accent px-3 py-2.5 text-white",
                      line.role === "assistant" && "text-[#475467]",
                      line.role === "system" &&
                        "rounded-md bg-[#fffaeb] px-2.5 py-2 text-[#b54708]",
                    )}
                  >
                    {line.text}
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <form
            className="mx-3 mb-3 shrink-0 rounded-lg border border-[#d0d5dd] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void onSend();
            }}
          >
            <textarea
              className="max-h-[18dvh] min-h-10 w-full resize-none border-0 bg-transparent text-[11px] text-[#475467] outline-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                sessionId ? "描述任务，或从工作区引用文件…" : "请先创建会话"
              }
              disabled={!sessionId || busy}
              rows={2}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px] text-[#667085]">
              <span>
                {active
                  ? `${active.runtimeType} · ${active.credential.label}`
                  : "Enter 发送 · Shift+Enter 换行（示意）"}
              </span>
              <Button
                type="submit"
                size="sm"
                disabled={!sessionId || busy || !draft.trim()}
              >
                <Icon icon={Send} size="sm" />
                发送
              </Button>
            </div>
          </form>
        </section>

        <aside
          className="flex min-h-0 flex-col overflow-hidden bg-[#fbfcfd]"
          aria-label="工作空间文件预览"
        >
          <div className="flex min-h-[42px] shrink-0 items-center border-b border-ah-line px-3">
            <span className="text-[10px] text-[#98a2b3]">文件预览</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef1ed] px-3.5 py-2.5 font-mono text-[9px] leading-[1.5] text-[#667085]">
            <span>/workspace</span>
            <span className={ui.badge}>个人工作区</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3.5 py-4 text-[10px] leading-[2] text-[#86968a]">
            <p className="m-0">
              引擎：{active?.runtimeType ?? "OpenCode"}
              <br />
              凭据：{active?.credential.label ?? "会话创建时选择"}
              <br />
              状态：{active?.status ?? "待命"}
            </p>
            <hr className="my-4 border-0 border-t border-ah-line" />
            <p className="m-0 text-[#9aa79d]">
              在左侧打开文件后，此处展示预览与 diff。P1 将接入白名单反代与权限确认弹窗。
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function extractText(parts: unknown[]): string {
  return parts
    .map((p) => {
      if (p && typeof p === "object" && "type" in p && (p as { type: string }).type === "text") {
        return String((p as { text?: string }).text ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function applyEnvelope(
  envelope: Envelope,
  setLines: Dispatch<SetStateAction<ChatLine[]>>,
  buf: Map<string, string>,
) {
  if (envelope.type === "assistant.delta") {
    const { messageId, text } = envelope.data as { messageId: string; text: string };
    const next = (buf.get(messageId) ?? "") + text;
    buf.set(messageId, next);
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === messageId);
      if (idx === -1) return [...prev, { id: messageId, role: "assistant", text: next }];
      const copy = [...prev];
      copy[idx] = { id: messageId, role: "assistant", text: next };
      return copy;
    });
    return;
  }
  if (envelope.type === "assistant.message") {
    const { messageId, text } = envelope.data as { messageId: string; text: string };
    buf.set(messageId, text);
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === messageId);
      if (idx === -1) return [...prev, { id: messageId, role: "assistant", text }];
      const copy = [...prev];
      copy[idx] = { id: messageId, role: "assistant", text };
      return copy;
    });
    return;
  }
  if (envelope.type === "error") {
    const data = envelope.data as { code: string; message: string };
    setLines((prev) => [
      ...prev,
      { id: `err-${envelope.seq}`, role: "system", text: `${data.code}: ${data.message}` },
    ]);
  }
}
