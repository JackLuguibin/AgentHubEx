/** Pure helpers for topbar switcher / workspace entry guards (DoD). */

export type SwitcherTenant = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
};

export type SwitcherProject = {
  id: string;
  key: string;
  name: string;
  archivedAt: string | null;
  myRole: string | null;
};

/** Bound + active tenants only (memberships already imply binding). */
export function filterSwitcherTenants(tenants: SwitcherTenant[]): SwitcherTenant[] {
  return tenants.filter((t) => t.status === "active");
}

/** Bound (has myRole) + not archived projects under the current tenant. */
export function filterSwitcherProjects(projects: SwitcherProject[]): SwitcherProject[] {
  return projects.filter((p) => p.archivedAt == null && p.myRole != null);
}

export function isTenantUsable(tenant: SwitcherTenant | null | undefined): boolean {
  return Boolean(tenant && tenant.status === "active");
}

export function isProjectUsable(project: SwitcherProject | null | undefined): boolean {
  return Boolean(project && project.archivedAt == null && project.myRole != null);
}
