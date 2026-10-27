import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Db } from "@agenthub/db";
import {
  agentSessions,
  projectCredentials,
  usageRecords,
  userCredentials,
} from "@agenthub/db";
import { can, effectiveProjectRole } from "@agenthub/auth";
import { forbidden } from "../errors.js";
import { newId } from "../lib/id.js";
import { addDailyTokenUsage } from "../lib/token-quota.js";
import { resolveProjectAccess } from "./projects.js";
import { requireTenantAdmin } from "./tenants.js";

export type UsageSource = "runtime_event" | "llm_proxy";

export type UsageWrite = {
  tenantId: string;
  projectId: string;
  userId: string;
  sessionId: string;
  credentialSource: "user" | "project";
  credentialId: string;
  provider?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  costMicros?: number | null;
  source: UsageSource;
};

export async function recordUsage(db: Db, redis: Redis, input: UsageWrite) {
  const provider = input.provider ?? (await providerOf(db, input.credentialSource, input.credentialId));
  await db.insert(usageRecords).values({
    id: newId(),
    tenantId: input.tenantId,
    projectId: input.projectId,
    userId: input.userId,
    sessionId: input.sessionId,
    credentialSource: input.credentialSource,
    credentialId: input.credentialId,
    provider,
    model: input.model || "unknown",
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    costMicros: input.costMicros ?? null,
    source: input.source,
    at: new Date(),
  });
  await addDailyTokenUsage(redis, input.tenantId, input.inputTokens + input.outputTokens);
  await db
    .update(agentSessions)
    .set({
      usageInputTokens: sql`${agentSessions.usageInputTokens} + ${input.inputTokens}`,
      usageOutputTokens: sql`${agentSessions.usageOutputTokens} + ${input.outputTokens}`,
      updatedAt: new Date(),
    })
    .where(eq(agentSessions.id, input.sessionId));
}

export type UsageBucket = {
  key: string;
  credentialSource: "user" | "project";
  credentialId: string;
  userId: string;
  projectId: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: number | null;
};

export async function listProjectUsage(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
  query: UsageQuery,
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "project.read", { isPlatformAdmin })) {
    throw forbidden();
  }
  const role = effectiveProjectRole(access.projectRole, access.tenantRole);
  const seeProject = role === "owner" || isPlatformAdmin;
  const rows = await loadRows(db, { tenantId: access.project.tenantId, projectId, from: query.from, to: query.to });
  return {
    items: aggregate(
      rows.filter((row) => visible(row, userId, seeProject)),
      query.groupBy,
    ),
  };
}

export async function listTenantUsage(
  db: Db,
  tenantId: string,
  userId: string,
  isPlatformAdmin: boolean,
  query: UsageQuery,
) {
  await requireTenantAdmin(db, tenantId, userId, isPlatformAdmin);
  const rows = await loadRows(db, { tenantId, from: query.from, to: query.to });
  return {
    items: aggregate(
      rows.filter((row) => visible(row, userId, true)),
      query.groupBy,
    ),
  };
}

export type UsageQuery = {
  from: Date;
  to: Date;
  groupBy: "project" | "user" | "day" | "credential";
};

type UsageRow = typeof usageRecords.$inferSelect;

async function loadRows(
  db: Db,
  scope: { tenantId: string; projectId?: string; from: Date; to: Date },
) {
  const conditions = [
    eq(usageRecords.tenantId, scope.tenantId),
    gte(usageRecords.at, scope.from),
    lt(usageRecords.at, scope.to),
  ];
  if (scope.projectId) conditions.push(eq(usageRecords.projectId, scope.projectId));
  const rows = await db
    .select()
    .from(usageRecords)
    .where(and(...conditions));
  return preferProxy(rows);
}

/** Proxy rows replace best-effort runtime events for the same session. */
function preferProxy(rows: UsageRow[]): UsageRow[] {
  const proxied = new Set(
    rows.filter((row) => row.source === "llm_proxy" && row.sessionId).map((row) => row.sessionId),
  );
  return rows.filter(
    (row) => row.source === "llm_proxy" || !row.sessionId || !proxied.has(row.sessionId),
  );
}

function visible(row: UsageRow, userId: string, seeProject: boolean) {
  if (row.credentialSource === "user") return row.userId === userId;
  return seeProject;
}

function aggregate(rows: UsageRow[], groupBy: UsageQuery["groupBy"]): UsageBucket[] {
  const buckets = new Map<string, UsageBucket>();
  for (const row of rows) {
    const source = row.credentialSource === "project" ? "project" : "user";
    const key =
      groupBy === "day"
        ? `${row.at.toISOString().slice(0, 10)}:${source}`
        : groupBy === "user"
          ? `${row.userId}:${source}`
          : groupBy === "project"
            ? `${row.projectId}:${source}`
            : `${source}:${row.credentialId}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        key,
        credentialSource: source,
        credentialId: row.credentialId,
        userId: row.userId,
        projectId: row.projectId,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costMicros: row.costMicros,
      });
      continue;
    }
    existing.inputTokens += row.inputTokens;
    existing.outputTokens += row.outputTokens;
    if (row.costMicros != null) existing.costMicros = (existing.costMicros ?? 0) + row.costMicros;
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function providerOf(db: Db, source: "user" | "project", credentialId: string) {
  if (source === "user") {
    const [row] = await db
      .select({ provider: userCredentials.provider })
      .from(userCredentials)
      .where(eq(userCredentials.id, credentialId))
      .limit(1);
    return row?.provider ?? "unknown";
  }
  const [row] = await db
    .select({ provider: projectCredentials.provider })
    .from(projectCredentials)
    .where(eq(projectCredentials.id, credentialId))
    .limit(1);
  return row?.provider ?? "unknown";
}
