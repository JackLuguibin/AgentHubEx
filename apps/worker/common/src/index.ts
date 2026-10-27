import { randomUUID, timingSafeEqual } from "node:crypto";

export type BusEvent = {
  id: string;
  v: 1;
  ts: string;
  type: string;
  data: unknown;
  sessionRef: string;
  raw?: unknown;
};

export class EventBus {
  private recent = new Map<string, BusEvent[]>();
  private listeners = new Map<string, Set<(event: BusEvent) => void>>();

  constructor(private limit = 200) {}

  publish(event: BusEvent) {
    const list = this.recent.get(event.sessionRef) ?? [];
    list.push(event);
    while (list.length > this.limit) list.shift();
    this.recent.set(event.sessionRef, list);
    for (const listener of this.listeners.get(event.sessionRef) ?? []) listener(event);
  }

  snapshot(sessionRef: string): BusEvent[] {
    return [...(this.recent.get(sessionRef) ?? [])];
  }

  subscribe(sessionRef: string, listener: (event: BusEvent) => void): () => void {
    const set = this.listeners.get(sessionRef) ?? new Set();
    set.add(listener);
    this.listeners.set(sessionRef, set);
    return () => {
      set.delete(listener);
    };
  }
}

export function createBusEvent(
  sessionRef: string,
  type: string,
  data: unknown,
  raw?: unknown,
): BusEvent {
  return {
    id: randomUUID(),
    v: 1,
    ts: new Date().toISOString(),
    type,
    data,
    sessionRef,
    ...(raw !== undefined ? { raw } : {}),
  };
}

export function passwordMatches(header: string | undefined, token: string): boolean {
  if (!token || !header?.toLowerCase().startsWith("basic ")) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return false;
  }
  const split = decoded.indexOf(":");
  if (split < 0) return false;
  const password = Buffer.from(decoded.slice(split + 1));
  const expected = Buffer.from(token);
  if (password.length !== expected.length) return false;
  return timingSafeEqual(password, expected);
}
