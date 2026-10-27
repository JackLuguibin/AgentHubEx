import { and, count, eq, isNull } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { projectMemberships, projects, users } from "@agenthub/db";
import type { ProjectRole } from "@agenthub/auth";
import { can } from "@agenthub/auth";
import type { Project } from "@agenthub/domain";
import { conflict, forbidden, notFound } from "../errors.js";
import { newId } from "../lib/id.js";
import { etagFromUpdatedAt, toIso } from "../lib/time.js";
import {
  assertTenantActive,
  requireTenantAdmin,
  requireTenantMember,
} from "./tenants.js";
import { abortLiveSessions } from "./session-lifecycle.js";
import { findOrCreateUserByEmail, getTenantMembership, getUserOrThrow } from "./users.js";

const DEFAULT_SETTINGS = {
  strictConfig: false,
  promoteRequiresReview: true,
  allowSharedPush: false,
  workspaceSpec: { cpu: 2, memMb: 4096, diskGb: 20 },
  defaultRuntimeType: "opencode" as const,
};

function mapProject(
  row: typeof projects.$inferSelect,
  myRole: ProjectRole | null,
): Project {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...((row.settings ?? {}) as object),
  };
  return {
    id: row.id,
    tenantId: row.tenantId,
    key: row.key,
    name: row.name,
    description: row.description ?? undefined,
    credentialPolicy: row.credentialPolicy as Project["credentialPolicy"],
    commonSyncPolicy: row.commonSyncPolicy as Project["commonSyncPolicy"],
    settings: settings as Project["settings"],
    myRole,
    archivedAt: toIso(row.archivedAt),
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
    etag: etagFromUpdatedAt(row.updatedAt),
  };
}

export async function getProjectRow(db: Db, projectId: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) throw notFound("Project not found");
  return row;
}

export async function getProjectMembership(db: Db, projectId: string, userId: string) {
  const [row] = await db
    .select()
    .from(projectMemberships)
    .where(
      and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)),
    )
    .limit(1);
  return row ?? null;
}

export async function resolveProjectAccess(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const project = await getProjectRow(db, projectId);
  const tenantMembership = await getTenantMembership(db, project.tenantId, userId);
  const projectMembership = await getProjectMembership(db, projectId, userId);
  const tenantRole = isPlatformAdmin
    ? ("owner" as const)
    : ((tenantMembership?.role as "owner" | "admin" | "member" | undefined) ?? null);
  const projectRole = (projectMembership?.role as ProjectRole | null) ?? null;

  if (!isPlatformAdmin && !tenantMembership) throw notFound("Project not found");
  if (
    !isPlatformAdmin &&
    !projectMembership &&
    tenantRole !== "admin" &&
    tenantRole !== "owner"
  ) {
    throw notFound("Project not found");
  }

  return { project, tenantRole, projectRole };
}

export async function createProject(
  db: Db,
  tenantId: string,
  actorUserId: string,
  input: {
    key: string;
    name: string;
    description?: string;
    credentialPolicy?: Project["credentialPolicy"];
    settings?: Partial<Project["settings"]>;
  },
) {
  await assertTenantActive(db, tenantId);
  const [dup] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.tenantId, tenantId), eq(projects.key, input.key)))
    .limit(1);
  if (dup) throw conflict("Project key already exists in tenant");

  const id = newId();
  const settings = { ...DEFAULT_SETTINGS, ...(input.settings ?? {}) };
  const [row] = await db
    .insert(projects)
    .values({
      id,
      tenantId,
      key: input.key,
      name: input.name,
      description: input.description,
      credentialPolicy: input.credentialPolicy ?? "user_or_project",
      settings,
    })
    .returning();
  if (!row) throw new Error("failed to create project");

  await db.insert(projectMemberships).values({
    tenantId,
    projectId: id,
    userId: actorUserId,
    role: "owner",
  });

  return mapProject(row, "owner");
}

export async function listProjects(
  db: Db,
  tenantId: string,
  userId: string,
  isPlatformAdmin: boolean,
  opts: { archived?: boolean } = {},
) {
  await requireTenantMember(db, tenantId, userId, isPlatformAdmin);
  const rows = await db.select().from(projects).where(eq(projects.tenantId, tenantId));
  const filtered = rows.filter((r) =>
    opts.archived ? r.archivedAt != null : r.archivedAt == null,
  );

  const items: Project[] = [];
  for (const row of filtered) {
    const access = await resolveProjectAccess(db, row.id, userId, isPlatformAdmin).catch(
      () => null,
    );
    if (!access) continue;
    const myRole =
      access.tenantRole === "admin" || access.tenantRole === "owner"
        ? ("owner" as const)
        : access.projectRole;
    items.push(mapProject(row, myRole));
  }
  return { items, nextCursor: null as string | null };
}

export async function getProject(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  const myRole =
    access.tenantRole === "admin" || access.tenantRole === "owner"
      ? "owner"
      : access.projectRole;
  return mapProject(access.project, myRole);
}

export async function patchProject(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
  patch: {
    name?: string;
    description?: string | null;
    credentialPolicy?: Project["credentialPolicy"];
    commonSyncPolicy?: Project["commonSyncPolicy"];
    settings?: Partial<Project["settings"]>;
  },
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "project.update", { isPlatformAdmin })) {
    throw forbidden();
  }
  if (access.project.archivedAt) {
    throw conflict("Project is archived", undefined, "PROJECT_ARCHIVED");
  }

  const nextSettings = {
    ...((access.project.settings ?? {}) as object),
    ...(patch.settings ?? {}),
  };
  const [updated] = await db
    .update(projects)
    .set({
      name: patch.name ?? access.project.name,
      description:
        patch.description === undefined ? access.project.description : patch.description,
      credentialPolicy: patch.credentialPolicy ?? access.project.credentialPolicy,
      commonSyncPolicy: patch.commonSyncPolicy ?? access.project.commonSyncPolicy,
      settings: nextSettings,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();

  return getProject(db, updated!.id, userId, isPlatformAdmin);
}

export async function archiveProject(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
  archive: boolean,
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "project.update", { isPlatformAdmin })) {
    throw forbidden();
  }
  if (archive === false) {
    await assertTenantActive(db, access.project.tenantId);
  }
  const [updated] = await db
    .update(projects)
    .set({
      archivedAt: archive ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();
  if (archive) {
    await abortLiveSessions(db, { projectId }, "project_archived");
  }
  return getProject(db, updated!.id, userId, isPlatformAdmin);
}

export async function listProjectMembers(db: Db, projectId: string) {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: projectMemberships.role,
    })
    .from(projectMemberships)
    .innerJoin(users, eq(users.id, projectMemberships.userId))
    .where(eq(projectMemberships.projectId, projectId));

  return {
    items: rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      displayName: r.displayName,
      role: r.role as ProjectRole,
    })),
    nextCursor: null as string | null,
  };
}

export async function addProjectMember(
  db: Db,
  projectId: string,
  actorUserId: string,
  isPlatformAdmin: boolean,
  input: { userId?: string; email?: string; role: ProjectRole },
) {
  const access = await resolveProjectAccess(db, projectId, actorUserId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "member.manage", { isPlatformAdmin })) {
    throw forbidden();
  }
  await assertTenantActive(db, access.project.tenantId);
  if (access.project.archivedAt) {
    throw conflict("Project is archived", undefined, "PROJECT_ARCHIVED");
  }

  let userId = input.userId;
  if (!userId && input.email) {
    const user = await findOrCreateUserByEmail(db, input.email);
    userId = user.id;
    const tm = await getTenantMembership(db, access.project.tenantId, userId);
    if (!tm) {
      // Auto-add as tenant member when inviting by email into a project
      const { tenantMemberships } = await import("@agenthub/db");
      await db.insert(tenantMemberships).values({
        tenantId: access.project.tenantId,
        userId,
        role: "member",
      });
    }
  }
  if (!userId) throw conflict("userId or email required");

  await getUserOrThrow(db, userId);
  const tm = await getTenantMembership(db, access.project.tenantId, userId);
  if (!tm) throw conflict("User must be a tenant member first");

  const existing = await getProjectMembership(db, projectId, userId);
  if (existing) throw conflict("User is already a project member");

  await db.insert(projectMemberships).values({
    tenantId: access.project.tenantId,
    projectId,
    userId,
    role: input.role,
  });

  const user = await getUserOrThrow(db, userId);
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    role: input.role,
  };
}

async function assertNotLastProjectOwner(db: Db, projectId: string, userId: string) {
  const [self] = await db
    .select()
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.projectId, projectId),
        eq(projectMemberships.userId, userId),
        eq(projectMemberships.role, "owner"),
      ),
    )
    .limit(1);
  if (!self) return;

  const [result] = await db
    .select({ c: count() })
    .from(projectMemberships)
    .where(
      and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.role, "owner")),
    );
  if ((result?.c ?? 0) <= 1) {
    throw conflict("Cannot remove or demote the last project owner");
  }
}

export async function patchProjectMember(
  db: Db,
  projectId: string,
  targetUserId: string,
  actorUserId: string,
  isPlatformAdmin: boolean,
  role: ProjectRole,
) {
  const access = await resolveProjectAccess(db, projectId, actorUserId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "member.manage", { isPlatformAdmin })) {
    throw forbidden();
  }
  const existing = await getProjectMembership(db, projectId, targetUserId);
  if (!existing) throw notFound("Member not found");
  if (existing.role === "owner" && role !== "owner") {
    await assertNotLastProjectOwner(db, projectId, targetUserId);
  }
  await db
    .update(projectMemberships)
    .set({ role })
    .where(
      and(
        eq(projectMemberships.projectId, projectId),
        eq(projectMemberships.userId, targetUserId),
      ),
    );
  const user = await getUserOrThrow(db, targetUserId);
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    role,
  };
}

export async function removeProjectMember(
  db: Db,
  projectId: string,
  targetUserId: string,
  actorUserId: string,
  isPlatformAdmin: boolean,
) {
  const access = await resolveProjectAccess(db, projectId, actorUserId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "member.manage", { isPlatformAdmin })) {
    throw forbidden();
  }
  const existing = await getProjectMembership(db, projectId, targetUserId);
  if (!existing) throw notFound("Member not found");
  if (existing.role === "owner") {
    await assertNotLastProjectOwner(db, projectId, targetUserId);
  }
  await abortLiveSessions(
    db,
    { projectId, ownerUserId: targetUserId },
    "member_removed",
  );
  await db
    .delete(projectMemberships)
    .where(
      and(
        eq(projectMemberships.projectId, projectId),
        eq(projectMemberships.userId, targetUserId),
      ),
    );
}

export async function assertCanCreateProject(
  db: Db,
  tenantId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  await requireTenantAdmin(db, tenantId, userId, isPlatformAdmin);
  await assertTenantActive(db, tenantId);
}

export { isNull };
