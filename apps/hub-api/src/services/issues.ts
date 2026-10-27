import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { agentSessions, projectIssues, projects, users } from "@agenthub/db";
import { can } from "@agenthub/auth";
import type { Issue, IssueStatus } from "@agenthub/domain";
import { AppError, conflict, forbidden, notFound } from "../errors.js";
import { newId } from "../lib/id.js";
import { rankBetween } from "../lib/rank.js";
import { etagFromUpdatedAt, toIso } from "../lib/time.js";
import { resolveProjectAccess } from "./projects.js";

const COLUMN_LIMIT = 50;
const LIST_LIMIT = 100;

const STATUSES: IssueStatus[] = ["todo", "in_progress", "in_review", "done", "cancelled"];

const NEEDS_CONFIRM = new Set<IssueStatus>(["in_review", "done"]);

/** Allowed moves. Owner (issue.force_close) may jump outside this graph. */
const ALLOWED: Record<string, IssueStatus[]> = {
  todo: ["in_progress", "cancelled"],
  in_progress: ["todo", "in_review", "done", "cancelled"],
  in_review: ["in_progress", "done", "cancelled"],
  done: ["in_progress"],
  cancelled: ["todo"],
};

export type IssueListQuery = {
  status?: IssueStatus;
  assignee?: string;
  label?: string;
  priority?: Issue["priority"];
  q?: string;
  includeCancelled?: boolean;
};

type IssueRow = typeof projectIssues.$inferSelect;

function etagMatches(header: string | undefined, current: string): boolean {
  if (!header) return false;
  const norm = (value: string) => value.trim().replace(/^W\//, "").replaceAll('"', "");
  return norm(header) === norm(current);
}

function likePattern(q: string) {
  return `%${q.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function nextRank(seq: number): string {
  return `0|${seq.toString(36).padStart(6, "0")}`;
}

async function loadLinkedSessions(db: Db, issueIds: string[], viewerId: string) {
  const grouped = new Map<string, Issue["linkedSessions"]>();
  if (issueIds.length === 0) return grouped;
  const rows = await db
    .select({
      id: agentSessions.id,
      title: agentSessions.title,
      ownerUserId: agentSessions.ownerUserId,
      ownerName: users.displayName,
      status: agentSessions.status,
      issueId: agentSessions.issueId,
    })
    .from(agentSessions)
    .innerJoin(users, eq(users.id, agentSessions.ownerUserId))
    .where(
      and(inArray(agentSessions.issueId, issueIds), ne(agentSessions.status, "archived")),
    );
  for (const row of rows) {
    if (!row.issueId) continue;
    const list = grouped.get(row.issueId) ?? [];
    list.push({
      id: row.id,
      title: row.title,
      ownerUserId: row.ownerUserId,
      ownerName: row.ownerName,
      status: row.status as Issue["linkedSessions"][number]["status"],
      canOpen: row.ownerUserId === viewerId,
    });
    grouped.set(row.issueId, list);
  }
  return grouped;
}

async function mapIssues(
  db: Db,
  rows: IssueRow[],
  projectKey: string,
  viewerId: string,
): Promise<Issue[]> {
  if (rows.length === 0) return [];
  const assigneeIds = [
    ...new Set(rows.map((row) => row.assigneeUserId).filter((id): id is string => Boolean(id))),
  ];
  const names = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const people = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, assigneeIds));
    for (const person of people) names.set(person.id, person.displayName);
  }
  const links = await loadLinkedSessions(
    db,
    rows.map((row) => row.id),
    viewerId,
  );
  return rows.map((row) => ({
    id: row.id,
    key: `${projectKey}-${row.seq}`,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    priority: row.priority as Issue["priority"],
    status: row.status as Issue["status"],
    assignee:
      row.assigneeUserId && names.has(row.assigneeUserId)
        ? { id: row.assigneeUserId, displayName: names.get(row.assigneeUserId)! }
        : null,
    labels: row.labels ?? [],
    rank: row.rank,
    resolutionNote: row.resolutionNote,
    linkedSessions: links.get(row.id) ?? [],
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
    etag: etagFromUpdatedAt(row.updatedAt),
  }));
}

function issueWhere(
  projectId: string,
  projectKey: string,
  userId: string,
  query: IssueListQuery,
) {
  const conditions = [eq(projectIssues.projectId, projectId), isNull(projectIssues.deletedAt)];
  if (query.status) conditions.push(eq(projectIssues.status, query.status));
  if (query.priority) conditions.push(eq(projectIssues.priority, query.priority));
  if (query.assignee) {
    const assigneeId = query.assignee === "me" ? userId : query.assignee;
    conditions.push(eq(projectIssues.assigneeUserId, assigneeId));
  }
  if (query.label) {
    conditions.push(sql`${query.label} = ANY(${projectIssues.labels})`);
  }
  const q = query.q?.trim();
  if (q) {
    const pattern = likePattern(q);
    conditions.push(
      or(
        ilike(projectIssues.title, pattern),
        ilike(projectIssues.description, pattern),
        sql`(${projectKey} || '-' || ${projectIssues.seq}::text) ILIKE ${pattern}`,
      )!,
    );
  }
  return and(...conditions);
}

async function requireIssueAccess(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
  perm: "issue.read" | "issue.write",
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, perm, { isPlatformAdmin })) {
    throw forbidden();
  }
  return access;
}

export async function listIssues(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
  query: IssueListQuery = {},
) {
  const access = await requireIssueAccess(db, projectId, userId, isPlatformAdmin, "issue.read");
  const rows = await db
    .select()
    .from(projectIssues)
    .where(issueWhere(projectId, access.project.key, userId, query))
    .orderBy(desc(projectIssues.updatedAt))
    .limit(LIST_LIMIT);
  const items = await mapIssues(db, rows, access.project.key, userId);
  return { items, nextCursor: null as string | null };
}

export async function getBoard(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
  query: IssueListQuery = {},
) {
  const access = await requireIssueAccess(db, projectId, userId, isPlatformAdmin, "issue.read");
  const where = issueWhere(projectId, access.project.key, userId, query);
  const counts = await db
    .select({
      status: projectIssues.status,
      total: sql<number>`cast(count(*) as int)`,
    })
    .from(projectIssues)
    .where(where)
    .groupBy(projectIssues.status);
  const totalByStatus = new Map(counts.map((row) => [row.status, Number(row.total)]));

  const columns = [];
  for (const status of STATUSES) {
    const total = totalByStatus.get(status) ?? 0;
    const includeItems = status !== "cancelled" || query.includeCancelled === true;
    const rows = includeItems
      ? await db
          .select()
          .from(projectIssues)
          .where(and(where, eq(projectIssues.status, status)))
          .orderBy(asc(projectIssues.rank))
          .limit(COLUMN_LIMIT)
      : [];
    const items = await mapIssues(db, rows, access.project.key, userId);
    columns.push({
      status,
      total,
      items,
      nextCursor: total > items.length ? (items.at(-1)?.rank ?? null) : null,
    });
  }
  return { columns };
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
  const access = await requireIssueAccess(db, projectId, userId, isPlatformAdmin, "issue.write");
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
  const [issue] = await mapIssues(db, [row!], access.project.key, userId);
  return issue!;
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
  const matched = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/.exec(idOrKey);
  if (!matched) return null;
  const key = matched[1]!;
  const seq = Number(matched[2]);
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

export async function getIssue(
  db: Db,
  idOrKey: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const row = await findIssue(db, idOrKey);
  if (!row) throw notFound("Issue not found");
  const access = await requireIssueAccess(db, row.projectId, userId, isPlatformAdmin, "issue.read");
  const [issue] = await mapIssues(db, [row], access.project.key, userId);
  return issue!;
}

async function resolveRank(
  db: Db,
  projectId: string,
  status: string,
  issueId: string,
  position?: { beforeId?: string; afterId?: string },
) {
  const siblings = await db
    .select({ id: projectIssues.id, rank: projectIssues.rank })
    .from(projectIssues)
    .where(
      and(
        eq(projectIssues.projectId, projectId),
        eq(projectIssues.status, status),
        isNull(projectIssues.deletedAt),
        ne(projectIssues.id, issueId),
      ),
    )
    .orderBy(asc(projectIssues.rank));

  if (!position?.beforeId && !position?.afterId) {
    return rankBetween(siblings.at(-1)?.rank ?? null, null);
  }

  const before = position.beforeId
    ? siblings.find((row) => row.id === position.beforeId)
    : undefined;
  const after = position.afterId ? siblings.find((row) => row.id === position.afterId) : undefined;
  if (position.beforeId && !before) {
    throw new AppError(409, "ISSUE_CONFLICT", "Board changed, refresh and try again");
  }
  if (position.afterId && !after) {
    throw new AppError(409, "ISSUE_CONFLICT", "Board changed, refresh and try again");
  }

  if (before && !after) {
    const index = siblings.findIndex((row) => row.id === before.id);
    return rankBetween(before.rank, siblings[index + 1]?.rank ?? null);
  }
  if (after && !before) {
    const index = siblings.findIndex((row) => row.id === after.id);
    return rankBetween(index > 0 ? siblings[index - 1]!.rank : null, after.rank);
  }
  return rankBetween(before!.rank, after!.rank);
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
    position?: { beforeId?: string; afterId?: string };
  },
  ifMatch?: string,
) {
  const row = await findIssue(db, idOrKey);
  if (!row) throw notFound("Issue not found");
  const access = await requireIssueAccess(db, row.projectId, userId, isPlatformAdmin, "issue.write");
  if (ifMatch && !etagMatches(ifMatch, etagFromUpdatedAt(row.updatedAt))) {
    throw new AppError(412, "PRECONDITION_FAILED", "Issue was updated by someone else");
  }

  const nextStatus = (input.status ?? row.status) as IssueStatus;
  if (input.status && input.status !== row.status) {
    const force = can(access.projectRole, access.tenantRole, "issue.force_close", {
      isPlatformAdmin,
    });
    const allowed = (ALLOWED[row.status] ?? []).includes(input.status);
    if (!allowed && !force) {
      throw new AppError(
        422,
        "INVALID_TRANSITION",
        `Cannot transition ${row.status} → ${input.status}`,
      );
    }
    if (NEEDS_CONFIRM.has(input.status)) {
      const note = input.resolutionNote?.trim() ?? "";
      if (!note) {
        throw new AppError(
          422,
          "INVALID_TRANSITION",
          "resolutionNote is required to enter in_review or done",
        );
      }
      const isAssignee = row.assigneeUserId === userId;
      const isCreator = row.createdBy === userId;
      if (!isAssignee && !isCreator && !force) {
        throw forbidden(
          "Only the assignee, creator, or project owner can move an issue to in_review or done",
        );
      }
    }
  }

  let rank = row.rank;
  if (input.position || nextStatus !== row.status) {
    rank = await resolveRank(db, row.projectId, nextStatus, row.id, input.position);
  }

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
      rank,
      resolutionNote:
        input.resolutionNote === undefined ? row.resolutionNote : input.resolutionNote,
      closedAt: closed,
      updatedAt: new Date(),
    })
    .where(eq(projectIssues.id, row.id))
    .returning();

  if (!updated) {
    throw new AppError(409, "ISSUE_CONFLICT", "Issue was updated by someone else");
  }
  const [issue] = await mapIssues(db, [updated], access.project.key, userId);
  return issue!;
}

export async function deleteIssue(
  db: Db,
  idOrKey: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const row = await findIssue(db, idOrKey);
  if (!row) throw notFound("Issue not found");
  const access = await requireIssueAccess(
    db,
    row.projectId,
    userId,
    isPlatformAdmin,
    "issue.read",
  );
  if (!can(access.projectRole, access.tenantRole, "issue.force_close", { isPlatformAdmin })) {
    throw forbidden();
  }
  await db
    .update(projectIssues)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(projectIssues.id, row.id));
  return { id: row.id, projectId: row.projectId };
}

/** Validates the issue belongs to the project before a session is created. */
export async function prepareSessionIssue(db: Db, projectId: string, issueId: string) {
  const [row] = await db
    .select()
    .from(projectIssues)
    .where(
      and(
        eq(projectIssues.id, issueId),
        eq(projectIssues.projectId, projectId),
        isNull(projectIssues.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw notFound("Issue not found");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw notFound("Project not found");
  return { id: row.id, key: `${project.key}-${row.seq}`, title: row.title };
}

/** Links the new session: todo becomes in_progress, empty assignee becomes the caller. */
export async function applySessionIssueLink(db: Db, issueId: string, userId: string) {
  const [row] = await db
    .select()
    .from(projectIssues)
    .where(and(eq(projectIssues.id, issueId), isNull(projectIssues.deletedAt)))
    .limit(1);
  if (!row) return;
  const nextStatus = row.status === "todo" ? "in_progress" : row.status;
  await db
    .update(projectIssues)
    .set({
      status: nextStatus,
      assigneeUserId: row.assigneeUserId ?? userId,
      closedAt: nextStatus === "done" || nextStatus === "cancelled" ? row.closedAt : null,
      updatedAt: new Date(),
    })
    .where(eq(projectIssues.id, row.id));
}
