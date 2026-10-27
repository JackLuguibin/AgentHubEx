import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";

export type PtyTarget =
  | { kind: "mock"; ptyId: string; workspaceId: string }
  | { kind: "live"; ptyId: string; workspaceId: string; url: string; authorization?: string };

type StoredTicket = PtyTarget & { exp: number };

const tickets = new Map<string, StoredTicket>();

export function issuePtyTicket(target: PtyTarget, ttlMs = 60_000) {
  const ticket = randomBytes(24).toString("base64url");
  tickets.set(ticket, { ...target, exp: Date.now() + ttlMs });
  return { ticket, ptyId: target.ptyId, expiresIn: Math.round(ttlMs / 1000) };
}

export function takePtyTicket(ticket: string, workspaceId: string): PtyTarget | null {
  const row = tickets.get(ticket);
  if (!row) return null;
  if (row.exp <= Date.now()) {
    tickets.delete(ticket);
    return null;
  }
  if (row.workspaceId !== workspaceId) return null;
  tickets.delete(ticket);
  if (row.kind === "live") {
    return {
      kind: "live",
      ptyId: row.ptyId,
      workspaceId: row.workspaceId,
      url: row.url,
      authorization: row.authorization,
    };
  }
  return { kind: "mock", ptyId: row.ptyId, workspaceId: row.workspaceId };
}

export function upstreamPtyUrl(baseUrl: string, ptyId: string, ticket?: string) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const prefix = url.pathname.replace(/\/$/, "");
  url.pathname = `${prefix}/pty/${encodeURIComponent(ptyId)}/connect`;
  url.search = ticket ? `?ticket=${encodeURIComponent(ticket)}` : "";
  url.hash = "";
  return url.toString();
}

export function readUpstreamId(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const record = body as { id?: unknown; data?: { id?: unknown } };
  if (typeof record.id === "string" && record.id) return record.id;
  if (record.data && typeof record.data.id === "string" && record.data.id) return record.data.id;
  return null;
}

export function readUpstreamTicket(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const record = body as {
    ticket?: unknown;
    token?: unknown;
    data?: { ticket?: unknown; token?: unknown };
  };
  for (const value of [record.ticket, record.token, record.data?.ticket, record.data?.token]) {
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export function attachPtyBridge(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      socket.destroy();
      return;
    }
    const match = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/pty\/connect$/);
    if (!match) {
      socket.destroy();
      return;
    }
    const workspaceId = decodeURIComponent(match[1] ?? "");
    const target = takePtyTicket(url.searchParams.get("ticket") ?? "", workspaceId);
    if (!target) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (target.kind === "mock") bindMockEcho(ws);
      else bindUpstream(ws, target);
    });
  });
}

function bindMockEcho(ws: WebSocket) {
  ws.send("\r\n工作台终端（模拟）。输入会回显，不会执行系统命令。\r\n$ ");
  ws.on("message", (data) => {
    const text = rawText(data);
    let line = "";
    for (const ch of text) {
      if (ch === "\r" || ch === "\n") {
        ws.send("\r\n$ ");
        line = "";
      } else if (ch === "\u007f" || ch === "\b") {
        if (line.length > 0) {
          line = line.slice(0, -1);
          ws.send("\b \b");
        }
      } else {
        line += ch;
        ws.send(ch);
      }
    }
  });
}

function bindUpstream(ws: WebSocket, target: Extract<PtyTarget, { kind: "live" }>) {
  const upstream = new WebSocket(target.url, {
    headers: target.authorization ? { authorization: target.authorization } : undefined,
  });
  const pending: RawData[] = [];
  upstream.on("open", () => {
    for (const item of pending) upstream.send(item);
    pending.length = 0;
  });
  upstream.on("message", (data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
  ws.on("message", (data) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
    else if (upstream.readyState === WebSocket.CONNECTING) pending.push(data);
  });
  upstream.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
  ws.on("close", () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  });
  upstream.on("error", () => {
    if (ws.readyState === WebSocket.OPEN) ws.send("\r\n终端连接中断\r\n");
    ws.close();
  });
}

function rawText(data: RawData) {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return Buffer.from(data).toString("utf8");
}
