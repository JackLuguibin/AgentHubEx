import { describe, expect, it } from "vitest";
import { probeProviderBaseUrl } from "./credentials.js";

describe("probeProviderBaseUrl", () => {
  it("rejects a missing or non-http address without calling the network", async () => {
    const secret = "sk-should-not-leak";
    const bad = await probeProviderBaseUrl("not a url", secret, 200);
    expect(bad.ok).toBe(false);
    expect(bad.error).not.toContain(secret);

    const file = await probeProviderBaseUrl("file:///tmp/key", secret, 200);
    expect(file.ok).toBe(false);
    expect(file.error).not.toContain(secret);
  });

  it("reports an unreachable host without including the secret", async () => {
    const secret = "sk-should-not-leak";
    const result = await probeProviderBaseUrl("http://127.0.0.1:1", secret, 300);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("无法连接该地址");
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
