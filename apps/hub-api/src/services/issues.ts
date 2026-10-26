import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { projectIssues, projects, users } from "@agenthub/db";
import { can } from "@agenthub/auth";
import type { Issue } from "@agenthub/domain";
import { AppError, conflict, forbidden, notFound } from "../errors.js";
import { newId } from "../lib/id.js";
import { etagFromUpdatedAt, toIso } from "../lib/time.js";
import { resolveProjectAccess } from "./projects.js";

async function mapIssue(
  db: Db,
  row: typeof projectIssues.$inferSelect,
  projectKey: string,
): Promise<Issue> {
  let assignee: Issue["assignee"] = null;
  if (row.assigneeUserId) {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, row.assigneeUserId))
      .limit(1);
    if (u) assignee = { id: u.id, displayName: u.displayName };
  }
  return {
    id: row.id,
    key: `${projectKey}-${row.seq}`,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    priority: row.priority as Issue["priority"],
    status: row.status as Issue["status"],
    assignee,
    labels: row.labels ?? [],
    rank: row.rank,
    resolutionNote: row.resolutionNote,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
    etag: etagFromUpdatedAt(row.updatedAt),
  };
}

function nextRank(seq: number): string {
  return `0|${seq.toString(36).padStart(6, "0")}`;
}

export async function listIssues(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "issue.read", { isPlatformAdmin })) {
    throw forbidden();
  }
  const rows = await db
    .select()
    .from(projectIssues)
    .where(and(eq(projectIssues.projectId, projectId), isNull(projectIssues.deletedAt)));
  const items = await Promise.all(rows.map((r) => mapIssue(db, r, access.project.key)));
  return { items, nextCursor: null as string | null };
}

export async function createIssue(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
  input: {
    title: string;
    description?: string;
    priority?: Issue["priority"];
    labels?: string[];
    assigneeUserId?: string;
    status?: "todo" | "in_progress";
  },
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "issue.write", { isPlatformAdmin })) {
    throw forbidden();
  }
  if (access.project.archivedAt) {
    throw conflict("Project is archived", undefined, "PROJECT_ARCHIVED");
  }

  const updated = await db
    .update(projects)
    .set({ issueSeq: sql`${projects.issueSeq} + 1`, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
    .returning();
  const seq = updated[0]!.issueSeq;
  const id = newId();
  const status = input.status ?? "todo";
  const [row] = await db
    .insert(projectIssues)
    .values({
      id,
      tenantId: access.project.tenantId,
      projectId,
      seq,
      title: input.title,
      description: input.description ?? "",
      priority: input.priority ?? "P2",
      status,
      assigneeUserId: input.assigneeUserId,
      labels: input.labels ?? [],
      rank: nextRank(seq),
      createdBy: userId,
    })
    .returning();
  return mapIssue(db, row!, access.project.key);
}

async function findIssue(db: Db, idOrKey: string) {
  const uuidLike =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey);
  if (uuidLike) {
    const [row] = await db
      .select()
      .from(projectIssues)
      .where(and(eq(projectIssues.id, idOrKey), isNull(projectIssues.deletedAt)))
      .limit(1);
    return row ?? null;
  }
  const m = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/.exec(idOrKey);
  if (!m) return null;
  const key = m[1]!;
  const seq = Number(m[2]);
  const [project] = await db.select().from(projects).where(eq(projects.key, key)).limit(1);
  if (!project) return null;
  const [row] = await db
    .select()
    .from(projectIssues)
    .where(
      and(
        eq(projectIssues.projectId, project.id),
        eq(projectIssues.seq, seq),
        isNull(projectIssues.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

const ALLOWED: Record<string, string[]> = {
  todo: ["in_progress", "cancelled"],
  in_progress: ["in_review", "todo", "cancelled"],
  in_review: ["done", "in_progress", "cancelled"],
  done: ["in_progress"],
  cancelled: ["todo"],
};

export async function getIssue(
  db: Db,
  idOrKey: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const row = await findIssue(db, idOrKey);
  if (!row) throw notFound("Issue not found");
  const access = await resolveProjectAccess(db, row.projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "issue.read", { isPlatformAdmin })) {
    throw forbidden();
  }
  return mapIssue(db, row, access.project.key);
}

export async function updateIssue(
  db: Db,
  idOrKey: string,
  userId: string,
  isPlatformAdmin: boolean,
  input: {
    title?: string;
    description?: string;
    priority?: Issue["priority"];
    labels?: string[];
    assigneeUserId?: string | null;
    status?: Issue["status"];
    resolutionNote?: string;
  },
) {
  const row = await findIssue(db, idOrKey);
  if (!row) throw notFound("Issue not found");
  const access = await resolveProjectAccess(db, row.projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "issue.write", { isPlatformAdmin })) {
    throw forbidden();
  }

  if (input.status && input.status !== row.status) {
    const allowed = ALLOWED[row.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new AppError(422, "INVALID_TRANSITION", `Cannot transition ${row.status} → ${input.status}`);
    }
  }

  const nextStatus = input.status ?? row.status;
  const closed =
    nextStatus === "done" || nextStatus === "cancelled" ? (row.closedAt ?? new Date()) : null;

  const [updated] = await db
    .update(projectIssues)
    .set({
      title: input.title ?? row.title,
      description: input.description ?? row.description,
      priority: input.priority ?? row.priority,
      labels: input.labels ?? row.labels,
      assigneeUserId:
        input.assigneeUserId === undefined ? row.assigneeUserId : input.assigneeUserId,
      status: nextStatus,
      resolutionNote: input.resolutionNote ?? row.resolutionNote,
      closedAt: closed,
      updatedAt: new Date(),
    })
    .where(eq(projectIssues.id, row.id))
    .returning();

  return mapIssue(db, updated!, access.project.key);
}

export async function deleteIssue(
  db: Db,
  idOrKey: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const row = await findIssue(db, idOrKey);
  if (!row) throw notFound("Issue not found");
  const access = await resolveProjectAccess(db, row.projectId, userId, isPlatformAdmin);
  if (
    !can(access.projectRole, access.tenantRole, "issue.force_close", { isPlatformAdmin })
  ) {
    throw forbidden();
  }
  await db
    .update(projectIssues)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(projectIssues.id, row.id));
}
