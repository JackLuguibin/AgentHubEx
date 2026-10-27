import { describe, expect, it } from "vitest";
import { signLlmProxyToken, verifyAccessToken, verifyLlmProxyToken } from "./jwt.js";

const secret = "llm-proxy-test-secret";

describe("llm proxy token", () => {
  it("round-trips session binding and is rejected as an access token", async () => {
    const token = await signLlmProxyToken(
      { sub: "user-1", sid: "sess-1", wid: "ws-1", tid: "ten-1", pid: "proj-1" },
      secret,
    );
    const claims = await verifyLlmProxyToken(token, secret);
    expect(claims).toEqual({
      sub: "user-1",
      sid: "sess-1",
      wid: "ws-1",
      tid: "ten-1",
      pid: "proj-1",
    });
    await expect(verifyAccessToken(token, secret)).rejects.toThrow();
  });
});
