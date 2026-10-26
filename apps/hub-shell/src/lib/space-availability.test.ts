import { describe, expect, it } from "vitest";
import {
  filterSwitcherProjects,
  filterSwitcherTenants,
  isProjectUsable,
  isTenantUsable,
} from "./space-availability.js";

describe("space-availability (DoD switcher)", () => {
  const tenants = [
    { id: "t1", name: "A", slug: "a", status: "active" as const },
    { id: "t2", name: "B", slug: "b", status: "suspended" as const },
  ];

  const projects = [
    {
      id: "p1",
      key: "AH",
      name: "Active",
      archivedAt: null,
      myRole: "owner",
    },
    {
      id: "p2",
      key: "OLD",
      name: "Archived",
      archivedAt: "2026-01-01T00:00:00.000Z",
      myRole: "owner",
    },
    {
      id: "p3",
      key: "VIS",
      name: "Unbound",
      archivedAt: null,
      myRole: null,
    },
  ];

  it("hides suspended tenants from switcher", () => {
    expect(filterSwitcherTenants(tenants).map((t) => t.id)).toEqual(["t1"]);
  });

  it("hides archived and unbound projects from switcher", () => {
    expect(filterSwitcherProjects(projects).map((p) => p.id)).toEqual(["p1"]);
  });

  it("marks suspended tenant / archived project unusable for workspace entry", () => {
    expect(isTenantUsable(tenants[0])).toBe(true);
    expect(isTenantUsable(tenants[1])).toBe(false);
    expect(isProjectUsable(projects[0])).toBe(true);
    expect(isProjectUsable(projects[1])).toBe(false);
    expect(isProjectUsable(projects[2])).toBe(false);
  });
});
