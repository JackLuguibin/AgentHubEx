/** Permissions from architecture 03.4 */
export type Permission =
  | "project.read"
  | "project.update"
  | "binding.manage"
  | "member.manage"
  | "issue.read"
  | "issue.write"
  | "issue.force_close"
  | "common.read"
  | "common.write"
  | "common.write_protected"
  | "workspace.own"
  | "session.create"
  | "session.own"
  | "session.audit_meta"
  | "credential.project.use"
  | "credential.project.manage"
  | "config.read_effective"
  | "config.manage"
  | "config.apply"
  | "instance.manage"
  | "node.manage";

export type ProjectRole = "owner" | "developer" | "viewer";
export type TenantRole = "owner" | "admin" | "member";

const PROJECT_PERMS: Record<ProjectRole, ReadonlySet<Permission>> = {
  viewer: new Set([
    "project.read",
    "issue.read",
    "common.read",
  ]),
  developer: new Set([
    "project.read",
    "issue.read",
    "issue.write",
    "common.read",
    "common.write",
    "workspace.own",
    "session.create",
    "session.own",
    "credential.project.use",
    "config.read_effective",
  ]),
  owner: new Set([
    "project.read",
    "project.update",
    "binding.manage",
    "member.manage",
    "issue.read",
    "issue.write",
    "issue.force_close",
    "common.read",
    "common.write",
    "common.write_protected",
    "workspace.own",
    "session.create",
    "session.own",
    "session.audit_meta",
    "credential.project.use",
    "credential.project.manage",
    "config.read_effective",
    "config.manage",
    "config.apply",
  ]),
};

/** tenant.admin management-surface ≡ project.owner (ADR-014); session body still owner-scoped elsewhere */
export function effectiveProjectRole(
  projectRole: ProjectRole | null,
  tenantRole: TenantRole | null,
  options?: { managementSurface?: boolean },
): ProjectRole | null {
  const management = options?.managementSurface ?? true;
  if (management && (tenantRole === "admin" || tenantRole === "owner")) {
    return "owner";
  }
  return projectRole;
}

export function roleHasPermission(role: ProjectRole, perm: Permission): boolean {
  return PROJECT_PERMS[role].has(perm);
}

export function can(
  projectRole: ProjectRole | null,
  tenantRole: TenantRole | null,
  perm: Permission,
  options?: { managementSurface?: boolean; isPlatformAdmin?: boolean },
): boolean {
  if (perm === "node.manage") {
    return options?.isPlatformAdmin === true;
  }
  if (perm === "instance.manage") {
    if (options?.isPlatformAdmin) return true;
    return tenantRole === "admin" || tenantRole === "owner";
  }
  const effective = effectiveProjectRole(projectRole, tenantRole, options);
  if (!effective) return false;
  return roleHasPermission(effective, perm);
}
