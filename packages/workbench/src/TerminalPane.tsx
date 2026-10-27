import { useEffect, useRef, useState } from "react";
import type { FacadeClient } from "@agenthub/agent-client";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Button, Icon } from "@agenthub/hub-ui-kit";
import { TerminalSquare } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

export function TerminalPane({
  client,
  workspaceId,
  apiBase,
}: {
  client: FacadeClient;
  workspaceId: string;
  apiBase: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "live" | "error">("idle");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !hostRef.current) return;
    const host = hostRef.current;
    const term = new Terminal({
      fontSize: 12,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: { background: "#0f172a", foreground: "#e2e8f0", cursor: "#e2e8f0" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    let session: { send: (data: string) => void; close: () => void } | null = null;
    let cancelled = false;
    const onData = term.onData((data) => session?.send(data));
    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);

    void client
      .openPty(workspaceId, {
        baseUrl: apiBase,
        cols: term.cols,
        rows: term.rows,
        onData: (chunk) => term.write(chunk),
        onClose: () => {
          if (!cancelled) setStatus("idle");
        },
      })
      .then((next) => {
        if (cancelled) {
          next.close();
          return;
        }
        session = next;
        setStatus("live");
        setDetail(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setDetail(err instanceof Error ? err.message : "终端连接失败");
        term.writeln(err instanceof Error ? err.message : "终端连接失败");
      });

    return () => {
      cancelled = true;
      onData.dispose();
      window.removeEventListener("resize", onResize);
      session?.close();
      term.dispose();
    };
  }, [open, workspaceId, apiBase, client]);

  return (
    <div className="shrink-0 border-t border-ah-line bg-[#0f172a]">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="flex items-center gap-1 text-[10px] text-[#cbd5e1]">
          <Icon icon={TerminalSquare} size="sm" />
          终端
          {status === "live" ? " · 已连接" : status === "error" ? " · 连接失败" : ""}
        </span>
        <Button size="sm" variant="secondary" onClick={() => setOpen((value) => !value)}>
          {open ? "关闭终端" : "打开终端"}
        </Button>
      </div>
      {detail && !open ? <p className="m-0 px-3 pb-2 text-[10px] text-[#fda29b]">{detail}</p> : null}
      {open ? <div ref={hostRef} className="h-40 overflow-hidden px-1 pb-1" /> : null}
    </div>
  );
}
