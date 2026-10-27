import { describe, expect, it } from "vitest";
import { nodeScore, rankNodes, semverLt, type SchedNode } from "./schedule.js";

function node(partial: Partial<SchedNode> & { id: string }): SchedNode {
  return {
    status: "active",
    labels: {},
    lastHeartbeatAtMs: 1_000_000,
    agentHealth: "ok",
    capacity: { cpu: 10, memMb: 100, diskGb: 100, workspaces: 0, maxWorkspaces: 10 },
    used: { cpu: 0, memMb: 0, diskGb: 0, workspaces: 0 },
    ...partial,
  };
}

const spec = { cpu: 2, memMb: 4, diskGb: 1 };
const now = 1_000_000;

describe("managed scheduler", () => {
  it("picks the freer node and keeps a sticky volume on its node", () => {
    const tight = node({
      id: "a",
      used: { cpu: 8, memMb: 10, diskGb: 1, workspaces: 1 },
    });
    const free = node({
      id: "b",
      used: { cpu: 1, memMb: 50, diskGb: 1, workspaces: 5 },
    });
    expect(nodeScore(free)).toBeGreaterThan(nodeScore(tight));
    expect(rankNodes([tight, free], spec, { now }).map((item) => item.id)).toEqual(["b", "a"]);
    expect(rankNodes([tight, free], spec, { now, stickyNodeId: "a" }).map((item) => item.id)).toEqual(["a"]);
  });

  it("skips draining, stale, unlabeled, and full nodes", () => {
    const draining = node({ id: "drain", status: "draining" });
    const stale = node({ id: "stale", lastHeartbeatAtMs: now - 61_000 });
    const otherPool = node({ id: "cpu", labels: { pool: "cpu" } });
    const full = node({
      id: "full",
      labels: { pool: "gpu" },
      used: { cpu: 10, memMb: 0, diskGb: 0, workspaces: 0 },
    });
    const ok = node({ id: "ok", labels: { pool: "gpu" } });
    expect(
      rankNodes([draining, stale, otherPool, full, ok], spec, {
        now,
        selector: { pool: "gpu" },
      }).map((item) => item.id),
    ).toEqual(["ok"]);
  });

  it("compares agent versions", () => {
    expect(semverLt("0.1.0", "0.2.0")).toBe(true);
    expect(semverLt("1.0.0", "0.9.9")).toBe(false);
    expect(semverLt("0.1.0", "0.1.0")).toBe(false);
  });
});
