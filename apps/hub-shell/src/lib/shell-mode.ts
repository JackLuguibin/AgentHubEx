/** Sidebar view switch. It filters navigation only; the API still enforces roles. */

export type ShellMode = "user" | "admin";

export const SHELL_MODE_STORAGE_KEY = "ah.shellMode";

export type ShellAccess = {
  isPlatformAdmin: boolean;
  tenantRole: string | null;
  projectRole: string | null;
};

const WORKSPACE_KEYS = [
  "overview",
  "board",
  "workbench",
  "instances",
  "config",
  "files",
] as const;

const ADMIN_KEYS = ["members", "credentials", "nodes", "audit", "settings"] as const;

export type ShellNav = {
  management: Array<"tenants" | "projects">;
  workspace: readonly string[];
  account: readonly string[];
  admin: readonly string[];
};

export function canUseAdminMode(access: ShellAccess): boolean {
  return (
    access.isPlatformAdmin ||
    access.tenantRole === "owner" ||
    access.tenantRole === "admin" ||
    access.projectRole === "owner"
  );
}

export function readStoredShellMode(value: string | null): ShellMode {
  return value === "admin" ? "admin" : "user";
}

/** While projects are still loading, keep a saved admin preference so a project owner does not flash into user mode. */
export function effectiveShellMode(
  preference: ShellMode,
  access: ShellAccess,
  accessPending: boolean,
): ShellMode {
  if (canUseAdminMode(access)) return preference;
  if (accessPending && preference === "admin") return "admin";
  return "user";
}

export function shellNav(mode: ShellMode, access: ShellAccess): ShellNav {
  if (mode !== "admin") {
    return {
      management: [],
      workspace: WORKSPACE_KEYS,
      account: ["credentials"],
      admin: [],
    };
  }
  return {
    management: access.isPlatformAdmin ? ["tenants", "projects"] : ["projects"],
    workspace: [],
    account: [],
    admin: ADMIN_KEYS,
  };
}

export function routeNavKey(pathname: string): string | null {
  if (pathname === "/tenants" || pathname.startsWith("/tenants/")) return "tenants";
  if (pathname === "/projects" || pathname.startsWith("/projects/")) return "projects";
  if (/^\/t\/[^/]+\/projects\/?$/.test(pathname)) return "projects";
  const match = pathname.match(/^\/p\/[^/]+\/([^/]+)/);
  if (!match) return null;
  if (match[1] === "issues") return "board";
  return match[1]!;
}

export function routeAllowed(pathname: string, nav: ShellNav): boolean {
  const key = routeNavKey(pathname);
  if (key == null || key === "projects") return true;
  return (
    nav.management.includes(key as "tenants" | "projects") ||
    nav.workspace.includes(key) ||
    nav.account.includes(key) ||
    nav.admin.includes(key)
  );
}

export function shellFallbackPath(
  nav: ShellNav,
  ctx: { tenantId: string | null; projectId: string | null; projectUsable: boolean },
): string {
  const projectBase = ctx.projectUsable && ctx.projectId ? `/p/${ctx.projectId}` : null;
  if (nav.admin.length > 0) {
    if (projectBase) return `${projectBase}/members`;
    if (ctx.tenantId) return `/t/${ctx.tenantId}/projects`;
    if (nav.management.includes("tenants")) return "/tenants";
    return "/projects";
  }
  if (projectBase) return `${projectBase}/overview`;
  if (ctx.tenantId) return `/t/${ctx.tenantId}/projects`;
  return "/projects";
}
