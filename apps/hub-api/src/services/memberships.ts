import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import {
  projectMemberships,
  projects,
  tenantMemberships,
  tenants,
  users,
} from "@agenthub/db";
import type { ProjectRole, TenantRole } from "@agenthub/auth";
import type {
  CreateInvitationReq,
  DirectoryUser,
  PutUserBindingsReq,
  UserBindings,
} from "@agenthub/domain";
import { conflict, forbidden, notFound } from "../errors.js";
import { newId } from "../lib/id.js";
import { toIso } from "../lib/time.js";
import {
  findOrCreateUserByEmail,
  findUserByEmail,
  getTenantMembership,
  getUserOrThrow,
} from "./users.js";
import { requireTenantAdmin } from "./tenants.js";

async function listManageableTenantIds(
  db: Db,
  actorUserId: string,
  isPlatformAdmin: boolean,
): Promise<string[]> {
  if (isPlatformAdmin) {
    const rows = await db.select({ id: tenants.id }).from(tenants);
    return rows.map((r) => r.id);
  }
  const rows = await db
    .select({ tenantId: tenantMemberships.tenantId, role: tenantMemberships.role })
    .from(tenantMemberships)
    .where(eq(tenantMemberships.userId, actorUserId));
  return rows
    .filter((r) => r.role === "owner" || r.role === "admin")
    .map((r) => r.tenantId);
}

async function assertCanViewUser(
  db: Db,
  targetUserId: string,
  actorUserId: string,
  isPlatformAdmin: boolean,
) {
  if (isPlatformAdmin || targetUserId === actorUserId) return;
  const manageable = await listManageableTenantIds(db, actorUserId, false);
  if (manageable.length === 0) throw forbidden();
  const [shared] = await db
    .select()
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.userId, targetUserId),
        inArray(tenantMemberships.tenantId, manageable),
      ),
    )
    .limit(1);
  if (!shared) throw notFound("User not found");
}

export async function getUserBindings(
  db: Db,
  targetUserId: string,
  actorUserId: string,
  isPlatformAdmin: boolean,
): Promise<UserBindings> {
  await assertCanViewUser(db, targetUserId, actorUserId, isPlatformAdmin);
  const user = await getUserOrThrow(db, targetUserId);

  const tenantRows = await db
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      status: tenants.status,
      role: tenantMemberships.role,
    })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(eq(tenantMemberships.userId, targetUserId));

  const projectRows = await db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      projectKey: projects.key,
      tenantId: projects.tenantId,
      role: projectMemberships.role,
      archivedAt: projects.archivedAt,
    })
    .from(projectMemberships)
    .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
    .where(eq(projectMemberships.userId, targetUserId));

  // Non-admins only see bindings for tenants they manage (or their own full view when self).
  const manageable = await listManageableTenantIds(db, actorUserId, isPlatformAdmin);
  const canSeeAll = isPlatformAdmin || targetUserId === actorUserId;
  const tenantFilter = canSeeAll
    ? null
    : new Set(manageable);

  const tenantsOut = tenantRows
    .filter((r) => !tenantFilter || tenantFilter.has(r.tenantId))
    .map((r) => ({
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      tenantSlug: r.tenantSlug,
      status: r.status as "active" | "suspended",
      role: r.role as TenantRole,
    }));

  const projectsOut = projectRows
    .filter((r) => !tenantFilter || tenantFilter.has(r.tenantId))
    .map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName,
      projectKey: r.projectKey,
      tenantId: r.tenantId,
      role: r.role as ProjectRole,
      archivedAt: toIso(r.archivedAt),
    }));

  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    tenants: tenantsOut,
    projects: projectsOut,
  };
}

export async function listDirectoryUsers(
  db: Db,
  actorUserId: string,
  isPlatformAdmin: boolean,
  opts: { tenantId?: string; q?: string } = {},
): Promise<{ items: DirectoryUser[]; nextCursor: string | null }> {
  const manageable = await listManageableTenantIds(db, actorUserId, isPlatformAdmin);
  if (manageable.length === 0) throw forbidden("Tenant admin required");

  let scope = manageable;
  if (opts.tenantId) {
    if (!manageable.includes(opts.tenantId) && !isPlatformAdmin) {
      throw forbidden("Tenant admin required");
    }
    if (isPlatformAdmin && !manageable.includes(opts.tenantId)) {
      scope = [opts.tenantId];
    } else {
      scope = [opts.tenantId];
    }
  }

  const memberRows = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(inArray(tenantMemberships.tenantId, scope));

  const byUser = new Map<string, { userId: string; email: string; displayName: string }>();
  for (const row of memberRows) {
    byUser.set(row.userId, row);
  }

  const q = opts.q?.trim().toLowerCase();
  let usersList = [...byUser.values()];
  if (q) {
    usersList = usersList.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q),
    );
  }
  usersList.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const items: DirectoryUser[] = [];
  for (const u of usersList) {
    const bindings = await getUserBindings(db, u.userId, actorUserId, isPlatformAdmin);
    items.push({
      userId: bindings.userId,
      email: bindings.email,
      displayName: bindings.displayName,
      tenants: bindings.tenants,
      projects: bindings.projects,
    });
  }

  return { items, nextCursor: null };
}

async function countTenantOwners(db: Db, tenantId: string) {
  const rows = await db
    .select()
    .from(tenantMemberships)
    .where(
      and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.role, "owner")),
    );
  return rows.length;
}

async function countProjectOwners(db: Db, projectId: string) {
  const rows = await db
    .select()
    .from(projectMemberships)
    .where(
      and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.role, "owner")),
    );
  return rows.length;
}

export async function putUserBindings(
  db: Db,
  targetUserId: string,
  actorUserId: string,
  isPlatformAdmin: boolean,
  input: PutUserBindingsReq,
): Promise<UserBindings> {
  await getUserOrThrow(db, targetUserId);
  const manageable = await listManageableTenantIds(db, actorUserId, isPlatformAdmin);
  if (manageable.length === 0) throw forbidden("Tenant admin required");

  const desiredByTenant = new Map(
    input.tenants
      .filter((t) => manageable.includes(t.tenantId))
      .map((t) => [t.tenantId, t] as const),
  );

  // Validate projectIds belong to their tenants
  for (const [tenantId, desired] of desiredByTenant) {
    for (const p of desired.projects) {
      const [row] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, p.projectId), eq(projects.tenantId, tenantId)))
        .limit(1);
      if (!row) {
        throw conflict(`Project ${p.projectId} does not belong to tenant ${tenantId}`);
      }
    }
  }

  // Preflight last-owner protection across the whole batch
  for (const tenantId of manageable) {
    const desired = desiredByTenant.get(tenantId);
    const existing = await getTenantMembership(db, tenantId, targetUserId);
    const wasOwner = existing?.role === "owner";
    const willBeOwner = desired?.role === "owner";

    if (wasOwner && !willBeOwner) {
      const owners = await countTenantOwners(db, tenantId);
      if (owners <= 1) {
        const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        throw conflict(
          `Cannot remove or demote the last tenant owner${t ? ` (${t.name})` : ""}`,
        );
      }
    }

    const tenantProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.tenantId, tenantId));

    for (const project of tenantProjects) {
      const [existingPm] = await db
        .select()
        .from(projectMemberships)
        .where(
          and(
            eq(projectMemberships.projectId, project.id),
            eq(projectMemberships.userId, targetUserId),
          ),
        )
        .limit(1);
      const desiredRole = desired?.projects.find((p) => p.projectId === project.id)?.role;
      const wasProjectOwner = existingPm?.role === "owner";
      const willBeProjectOwner = desiredRole === "owner";
      if (wasProjectOwner && !willBeProjectOwner) {
        const owners = await countProjectOwners(db, project.id);
        if (owners <= 1) {
          throw conflict(
            `Cannot remove or demote the last project owner (${project.name})`,
          );
        }
      }
    }
  }

  // Apply: for each manageable tenant, sync memberships
  for (const tenantId of manageable) {
    const desired = desiredByTenant.get(tenantId);
    const existing = await getTenantMembership(db, tenantId, targetUserId);

    if (!desired) {
      if (existing) {
        await db
          .delete(tenantMemberships)
          .where(
            and(
              eq(tenantMemberships.tenantId, tenantId),
              eq(tenantMemberships.userId, targetUserId),
            ),
          );
      }
      continue;
    }

    if (!existing) {
      await db.insert(tenantMemberships).values({
        tenantId,
        userId: targetUserId,
        role: desired.role,
      });
    } else if (existing.role !== desired.role) {
      await db
        .update(tenantMemberships)
        .set({ role: desired.role })
        .where(
          and(
            eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.userId, targetUserId),
          ),
        );
    }

    const desiredProjectIds = new Set(desired.projects.map((p) => p.projectId));
    const currentProjects = await db
      .select()
      .from(projectMemberships)
      .where(
        and(
          eq(projectMemberships.tenantId, tenantId),
          eq(projectMemberships.userId, targetUserId),
        ),
      );

    for (const cur of currentProjects) {
      if (!desiredProjectIds.has(cur.projectId)) {
        await db
          .delete(projectMemberships)
          .where(
            and(
              eq(projectMemberships.projectId, cur.projectId),
              eq(projectMemberships.userId, targetUserId),
            ),
          );
      }
    }

    for (const p of desired.projects) {
      const [cur] = await db
        .select()
        .from(projectMemberships)
        .where(
          and(
            eq(projectMemberships.projectId, p.projectId),
            eq(projectMemberships.userId, targetUserId),
          ),
        )
        .limit(1);
      if (!cur) {
        await db.insert(projectMemberships).values({
          tenantId,
          projectId: p.projectId,
          userId: targetUserId,
          role: p.role,
        });
      } else if (cur.role !== p.role) {
        await db
          .update(projectMemberships)
          .set({ role: p.role })
          .where(
            and(
              eq(projectMemberships.projectId, p.projectId),
              eq(projectMemberships.userId, targetUserId),
            ),
          );
      }
    }
  }

  return getUserBindings(db, targetUserId, actorUserId, isPlatformAdmin);
}

/**
 * Invite by email: reuse existing User when present; apply tenant + optional project grants.
 * Returns an Invitation-shaped payload (immediate accept for local/dev; no SMTP).
 */
export async function createInvitation(
  db: Db,
  tenantId: string,
  actorUserId: string,
  isPlatformAdmin: boolean,
  input: CreateInvitationReq,
) {
  await requireTenantAdmin(db, tenantId, actorUserId, isPlatformAdmin);

  const email = input.email.trim().toLowerCase();
  const existingUser = await findUserByEmail(db, email);
  const user = await findOrCreateUserByEmail(db, email, input.displayName);
  const reusedExistingUser = Boolean(existingUser);

  const existingMembership = await getTenantMembership(db, tenantId, user.id);
  const tenantRole = input.tenantRole ?? "member";
  const projectGrants = input.projectGrants ?? [];

  if (!existingMembership) {
    await db.insert(tenantMemberships).values({
      tenantId,
      userId: user.id,
      role: tenantRole,
    });
  } else if (projectGrants.length === 0) {
    throw conflict("User is already a tenant member; manage bindings instead");
  }

  let granted = 0;
  for (const grant of projectGrants) {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, grant.projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    if (!project) throw notFound(`Project ${grant.projectId} not found in tenant`);

    const [pm] = await db
      .select()
      .from(projectMemberships)
      .where(
        and(
          eq(projectMemberships.projectId, grant.projectId),
          eq(projectMemberships.userId, user.id),
        ),
      )
      .limit(1);
    if (pm) {
      throw conflict("User is already a project member; manage bindings instead");
    }
    await db.insert(projectMemberships).values({
      tenantId,
      projectId: grant.projectId,
      userId: user.id,
      role: grant.role,
    });
    granted += 1;
  }

  if (existingMembership && granted === 0) {
    throw conflict("User is already a tenant member; manage bindings instead");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  return {
    id: newId(),
    email: user.email,
    tenantRole,
    projectGrants,
    expiresAt: expiresAt.toISOString(),
    acceptedAt: now.toISOString(),
    reusedExistingUser,
    userId: user.id,
  };
}

export async function listBindingCatalog(
  db: Db,
  actorUserId: string,
  isPlatformAdmin: boolean,
) {
  const manageable = await listManageableTenantIds(db, actorUserId, isPlatformAdmin);
  if (manageable.length === 0 && !isPlatformAdmin) {
    // Self-read catalog of own tenants still useful for read-only "my bindings"
    const own = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(eq(tenantMemberships.userId, actorUserId));
    const items = [];
    for (const t of own) {
      const projs = await db.select().from(projects).where(eq(projects.tenantId, t.id));
      items.push({
        tenantId: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status as "active" | "suspended",
        canEdit: false,
        projects: projs.map((p) => ({
          projectId: p.id,
          name: p.name,
          key: p.key,
          archivedAt: toIso(p.archivedAt),
        })),
      });
    }
    return { items };
  }

  const tenantRows =
    manageable.length === 0
      ? []
      : await db.select().from(tenants).where(inArray(tenants.id, manageable));

  const items = [];
  for (const t of tenantRows) {
    const projs = await db.select().from(projects).where(eq(projects.tenantId, t.id));
    items.push({
      tenantId: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status as "active" | "suspended",
      canEdit: true,
      projects: projs.map((p) => ({
        projectId: p.id,
        name: p.name,
        key: p.key,
        archivedAt: toIso(p.archivedAt),
      })),
    });
  }
  return { items };
}
