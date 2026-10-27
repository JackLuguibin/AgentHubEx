import { describe, expect, it } from "vitest";
import { ptyConnectUrl, sessionEventsUrl } from "./facade.js";

describe("pty connect url", () => {
  it("stays on the Hub and does not use the session event path", () => {
    const url = ptyConnectUrl("https://hub.internal", "ws-1", "ticket/1");
    expect(url).toBe("wss://hub.internal/v1/workspaces/ws-1/pty/connect?ticket=ticket%2F1");
    expect(url).not.toContain("/agent/session");
    expect(url).not.toContain("/agent/event");
    expect(sessionEventsUrl("https://hub.internal", "s1")).not.toContain("/pty");
  });
});
