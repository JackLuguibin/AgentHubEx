import { describe, expect, it } from "vitest";
import { issuePtyTicket, readUpstreamId, readUpstreamTicket, takePtyTicket, upstreamPtyUrl } from "./pty-bridge.js";

describe("pty bridge tickets", () => {
  it("accepts a ticket once and only for its workspace", () => {
    const issued = issuePtyTicket({ kind: "mock", ptyId: "pty-1", workspaceId: "ws-1" });
    expect(takePtyTicket(issued.ticket, "ws-other")).toBeNull();
    expect(takePtyTicket(issued.ticket, "ws-1")).toMatchObject({ kind: "mock", ptyId: "pty-1" });
    expect(takePtyTicket(issued.ticket, "ws-1")).toBeNull();
  });

  it("builds an upstream websocket url without keeping the http scheme", () => {
    expect(upstreamPtyUrl("http://127.0.0.1:4096", "abc", "ticket 1")).toBe(
      "ws://127.0.0.1:4096/pty/abc/connect?ticket=ticket%201",
    );
    expect(readUpstreamId({ data: { id: "pty-9" } })).toBe("pty-9");
    expect(readUpstreamTicket({ token: "once" })).toBe("once");
  });
});
