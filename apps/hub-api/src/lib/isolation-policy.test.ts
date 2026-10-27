import { describe, expect, it } from "vitest";
import { workerEgressPolicy, parseEgressAllowlist, CLOUD_METADATA_IP } from "./egress-allowlist.js";
import { hostMatchesAllowlist } from "./provider-hosts.js";
import { cursorMissing } from "./sse-cursor.js";
import { isDailyTokenQuotaExceeded, usageDayKey } from "./token-quota.js";

describe("isolation policy helpers", () => {
  it("matches exact hosts and one-label wildcards", () => {
    const rules = ["llm.internal.example", "*.corp.local"];
    expect(hostMatchesAllowlist("llm.internal.example", rules)).toBe(true);
    expect(hostMatchesAllowlist("a.corp.local", rules)).toBe(true);
    expect(hostMatchesAllowlist("corp.local", rules)).toBe(false);
    expect(hostMatchesAllowlist("api.openai.com", rules)).toBe(false);
  });

  it("treats a missing stream seq as a stale cursor", () => {
    expect(cursorMissing("1", [1, 2])).toBe(false);
    expect(cursorMissing("50", [1, 2])).toBe(true);
    expect(cursorMissing("nope", [1])).toBe(true);
  });

  it("blocks only after the daily token limit is reached", () => {
    expect(isDailyTokenQuotaExceeded(0, undefined)).toBe(false);
    expect(isDailyTokenQuotaExceeded(9, 10)).toBe(false);
    expect(isDailyTokenQuotaExceeded(10, 10)).toBe(true);
    expect(usageDayKey("t1", new Date("2026-10-26T23:30:00Z"))).toBe("usage:tok:t1:20261026");
  });

  it("denies public egress on intranet and airgap, and always denies metadata", () => {
    const intranet = workerEgressPolicy({
      profile: "intranet",
      allowlist: parseEgressAllowlist("10.0.0.0/8, llm.internal"),
      controlPlaneCidr: "172.16.0.0/12",
    });
    expect(intranet.defaultDenyPublic).toBe(true);
    expect(intranet.allow).toEqual(["10.0.0.0/8", "llm.internal"]);
    expect(intranet.deny).toContain(CLOUD_METADATA_IP);
    expect(intranet.deny).toContain("172.16.0.0/12");

    const airgap = workerEgressPolicy({ profile: "airgap", allowlist: ["10.1.0.5"] });
    expect(airgap.defaultDenyPublic).toBe(true);
    expect(airgap.allow).toEqual(["10.1.0.5"]);

    const lab = workerEgressPolicy({
      profile: "internet-lab",
      allowlist: ["0.0.0.0/0"],
      controlPlaneCidr: "172.16.0.0/12",
    });
    expect(lab.defaultDenyPublic).toBe(false);
    expect(lab.allow).toEqual([]);
    expect(lab.deny).toEqual([CLOUD_METADATA_IP, "172.16.0.0/12"]);
  });
});
