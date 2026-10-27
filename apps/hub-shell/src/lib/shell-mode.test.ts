import { describe, expect, it } from "vitest";
import {
  canUseAdminMode,
  effectiveShellMode,
  readStoredShellMode,
  routeAllowed,
  routeNavKey,
  shellFallbackPath,
  shellNav,
  type ShellAccess,
} from "./shell-mode.js";

const member: ShellAccess = {
  isPlatformAdmin: false,
  tenantRole: "member",
  projectRole: "developer",
};

const projectOwner: ShellAccess = {
  isPlatformAdmin: false,
  tenantRole: "member",
  projectRole: "owner",
};

const tenantAdmin: ShellAccess = {
  isPlatformAdmin: false,
  tenantRole: "admin",
  projectRole: "developer",
};

const platformAdmin: ShellAccess = {
  isPlatformAdmin: true,
  tenantRole: "member",
  projectRole: "developer",
};

describe("shell mode", () => {
  it("shows the switch only for real admin capabilities", () => {
    expect(canUseAdminMode(member)).toBe(false);
    expect(canUseAdminMode({ ...member, projectRole: "viewer" })).toBe(false);
    expect(canUseAdminMode(projectOwner)).toBe(true);
    expect(canUseAdminMode(tenantAdmin)).toBe(true);
    expect(canUseAdminMode(platformAdmin)).toBe(true);
  });

  it("drops a saved admin preference when the account cannot manage", () => {
    expect(readStoredShellMode("admin")).toBe("admin");
    expect(readStoredShellMode("nope")).toBe("user");
    expect(effectiveShellMode("admin", member, false)).toBe("user");
    expect(effectiveShellMode("admin", member, true)).toBe("admin");
    expect(effectiveShellMode("admin", projectOwner, false)).toBe("admin");
    expect(effectiveShellMode("user", platformAdmin, false)).toBe("user");
  });

  it("splits daily work from management, and keeps personal credentials in daily work", () => {
    const userNav = shellNav("user", platformAdmin);
    expect(userNav.workspace).toContain("workbench");
    expect(userNav.account).toEqual(["credentials"]);
    expect(userNav.management).toEqual([]);
    expect(userNav.admin).toEqual([]);

    const ownerNav = shellNav("admin", projectOwner);
    expect(ownerNav.workspace).toEqual([]);
    expect(ownerNav.management).toEqual(["projects"]);
    expect(ownerNav.admin).toContain("members");
    expect(ownerNav.admin).toContain("credentials");

    expect(shellNav("admin", platformAdmin).management).toEqual(["tenants", "projects"]);
  });

  it("sends a hidden page back to that mode's home", () => {
    const userNav = shellNav("user", member);
    const adminNav = shellNav("admin", tenantAdmin);
    expect(routeNavKey("/p/p1/issues/AH-1")).toBe("board");
    expect(routeNavKey("/t/t1/projects")).toBe("projects");
    expect(routeAllowed("/p/p1/members", userNav)).toBe(false);
    expect(routeAllowed("/t/t1/projects", userNav)).toBe(true);
    expect(routeAllowed("/tenants", adminNav)).toBe(false);
    expect(routeAllowed("/tenants", shellNav("admin", platformAdmin))).toBe(true);
    expect(
      shellFallbackPath(userNav, { tenantId: "t1", projectId: "p1", projectUsable: true }),
    ).toBe("/p/p1/overview");
    expect(
      shellFallbackPath(adminNav, { tenantId: "t1", projectId: "p1", projectUsable: true }),
    ).toBe("/p/p1/members");
    expect(
      shellFallbackPath(userNav, { tenantId: "t1", projectId: null, projectUsable: false }),
    ).toBe("/t/t1/projects");
  });
});
