import { describe, expect, it } from "vitest";
import { rankBetween } from "../lib/rank.js";

describe("rankBetween", () => {
  it("orders a new card after an existing seq rank and between two neighbors", () => {
    const first = "0|000001";
    const second = "0|000002";
    const after = rankBetween(second, null);
    const between = rankBetween(first, second);
    const before = rankBetween(null, first);
    expect(before < first).toBe(true);
    expect(first < between && between < second).toBe(true);
    expect(second < after).toBe(true);
  });
});