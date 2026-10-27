import { and, eq, inArray } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Db } from "@agenthub/db";
import {
  agentSessions,
  applyJobs,
  configAssignments,
  configBundles,
  jobsOutbox,
  projects,
  tenants,
  workspaces,
} from "@agenthub/db";
import type { ApplyJob } from "@agenthub/domain";
import { recordAudit } from "../lib/audit.js";
import { addHubJob, setHubJobHandler, startHubJobs, stopHubJobs } from "../lib/hub-jobs.js";
import { logger } from "../lib/logger.js";
import { newId } from "../lib/id.js";
import type { ObjectStore } from "../lib/object-store.js";
import { type ApplyEnv, runQueuedApplyJob } from "./apply-engine.js";
import { reencryptStoredSecrets } from "./reencrypt.js";
import { resolveEffectiveConfig } from "./config-bundles.js";
import { syncWorkspaceCommon } from "./common-space.js";

const ONLINE = ["ready", "idle"] as const;
export const AUTOSYNC_PER_MINUTE = 20;
export const COMMON_PUSH_DELAY_MS = 60_000;

type ApplyPayload = {
  applyJobId: string;
  workspaceId: string;
  targetHash: string;
  deferUntilIdle?: boolean;
};

export type AutoSyncDeps = {
  db: Db;
  applyEnv: ApplyEnv;
  store: ObjectStore;
};

let deps: AutoSyncDeps | null = null;

export async function reserveAutoSyncDelay(redis: Redis, projectId: string) {
  const key = `autosync:rate:${projectId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60);
  return Math.floor((count - 1) / AUTOSYNC_PER_MINUTE) * 60_000;
}

async function workspaceBusy(db: Db, workspaceId: string) {
  const [row] = await db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(and(eq(agentSessions.workspaceId, workspaceId), eq(agentSessions.status, "busy")))
    .limit(1);
  return Boolean(row);
}

async function markOutbox(db: Db, outboxId: string, status: "published" | "failed", error?: string) {
  await db
    .update(jobsOutbox)
    .set({
      status,
      publishedAt: status === "published" ? new Date() : null,
      lastError: error ?? null,
    })
    .where(and(eq(jobsOutbox.id, outboxId), inArray(jobsOutbox.status, ["pending", "failed"])));
}

function auditApply(input: {
  actorId: string;
  tenantId: string;
  projectId: string | null;
  workspaceId: string;
  job: ApplyJob;
  kind: "config" | "common";
}) {
  recordAudit({
    action: "apply.autosync",
    actorId: input.actorId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    targetType: "workspace",
    targetId: input.workspaceId,
    meta: {
      kind: input.kind,
      jobId: input.job.id,
      status: input.job.status,
      trigger: input.job.trigger,
      ...(input.job.error ? { error: input.job.error } : {}),
    },
  });
}

async function handleJob(name: string, data: { outboxId: string; applyJobId?: string; projectId?: string }) {
  if (!deps) throw new Error("auto sync is not running");
  try {
    if (name === "apply" && data.applyJobId) {
      await runQueuedApplyJob(deps.db, data.applyJobId, deps.applyEnv);
    } else if (name === "common_push" && data.projectId) {
      await pushCommonProject(deps, data.projectId);
    } else if (name === "reencrypt") {
      await reencryptStoredSecrets(deps.db, deps.applyEnv.platformDek);
    }
    await markOutbox(deps.db, data.outboxId, "published");
  } catch (err) {
    const message = err instanceof Error ? err.message : "自动同步失败";
    await markOutbox(deps.db, data.outboxId, "failed", message);
    throw err;
  }
}

async function pushCommonProject(active: AutoSyncDeps, projectId: string) {
  const [project] = await active.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || project.archivedAt) return;
  const rows = await active.db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.projectId, projectId), inArray(workspaces.status, [...ONLINE])));
  for (const workspace of rows) {
    try {
      const job = await syncWorkspaceCommon(
        active.db,
        active.store,
        workspace.id,
        { userId: workspace.ownerUserId, isPlatformAdmin: false },
        { applyRoot: active.applyEnv.applyRoot, nodeCaDir: active.applyEnv.nodeCaDir },
        "publish",
      );
      auditApply({
        actorId: workspace.ownerUserId,
        tenantId: workspace.tenantId,
        projectId,
        workspaceId: workspace.id,
        job,
        kind: "common",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "公共空间同步失败";
      const id = newId();
      await active.db.insert(applyJobs).values({
        id,
        tenantId: workspace.tenantId,
        workspaceId: workspace.id,
        instanceId: workspace.instanceId,
        kind: "common",
        targetHash: "failed",
        trigger: "publish",
        status: "failed",
        error: message,
        requestedBy: workspace.ownerUserId,
        startedAt: new Date(),
        finishedAt: new Date(),
      });
      recordAudit({
        action: "apply.autosync",
        actorId: workspace.ownerUserId,
        tenantId: workspace.tenantId,
        projectId,
        targetType: "workspace",
        targetId: workspace.id,
        meta: { kind: "common", jobId: id, status: "failed", trigger: "publish", error: message },
      });
    }
  }
}

async function projectCanPush(db: Db, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || project.archivedAt) return null;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, project.tenantId)).limit(1);
  if (!tenant || tenant.status !== "active") return null;
  return project;
}

export async function scheduleBundleAutoSync(
  db: Db,
  redis: Redis,
  bundleId: string,
  actorUserId: string,
) {
  const [bundle] = await db.select().from(configBundles).where(eq(configBundles.id, bundleId)).limit(1);
  if (!bundle) return { queued: 0, deferred: 0 };
  const targets: { projectId: string; ownerUserId?: string }[] = [];
  if (bundle.scope === "user" && bundle.scopeId && bundle.name.startsWith("overlay:")) {
    targets.push({ projectId: bundle.name.slice("overlay:".length), ownerUserId: bundle.scopeId });
  }
  const assigned = await db
    .select()
    .from(configAssignments)
    .where(and(eq(configAssignments.bundleId, bundleId), eq(configAssignments.pin, "latest")));
  for (const row of assigned) targets.push({ projectId: row.projectId });

  let queued = 0;
  let deferred = 0;
  for (const target of targets) {
    const project = await projectCanPush(db, target.projectId);
    if (!project) continue;
    const online = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.projectId, target.projectId), inArray(workspaces.status, [...ONLINE])));
    for (const workspace of online) {
      if (target.ownerUserId && workspace.ownerUserId !== target.ownerUserId) continue;
      const [pending] = await db
        .select({ id: applyJobs.id })
        .from(applyJobs)
        .where(
          and(
            eq(applyJobs.workspaceId, workspace.id),
            eq(applyJobs.kind, "config"),
            eq(applyJobs.trigger, "publish"),
            eq(applyJobs.status, "queued"),
          ),
        )
        .limit(1);
      if (pending) continue;
      try {
        const effective = await resolveEffectiveConfig(db, workspace.projectId, {
          userId: workspace.ownerUserId,
          isPlatformAdmin: false,
        });
        if (workspace.appliedRevisionHash === effective.hash) continue;
      } catch (err) {
        logger.warn({ err, workspaceId: workspace.id }, "auto sync will record a failed apply");
      }
      const busy = await workspaceBusy(db, workspace.id);
      const delayMs = busy ? 0 : await reserveAutoSyncDelay(redis, workspace.projectId);
      const id = newId();
      const payload: ApplyPayload = {
        applyJobId: id,
        workspaceId: workspace.id,
        targetHash: workspace.appliedRevisionHash ?? "pending",
        ...(busy ? { deferUntilIdle: true } : {}),
      };
      await db.transaction(async (tx) => {
        await tx.insert(applyJobs).values({
          id,
          tenantId: workspace.tenantId,
          workspaceId: workspace.id,
          instanceId: workspace.instanceId,
          kind: "config",
          targetHash: payload.targetHash,
          trigger: "publish",
          status: "queued",
          requestedBy: actorUserId,
        });
        await tx.insert(jobsOutbox).values({
          id,
          tenantId: workspace.tenantId,
          jobType: "apply",
          payload,
          status: "pending",
        });
      });
      if (busy) {
        deferred += 1;
        continue;
      }
      await addHubJob("apply", { outboxId: id, applyJobId: id }, { jobId: id, delayMs });
      queued += 1;
    }
  }
  return { queued, deferred };
}

export async function scheduleCommonPush(db: Db, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || project.archivedAt || project.commonSyncPolicy !== "on_common_publish") return;
  const jobId = `common-${projectId}`;
  const outboxId = newId();
  await db.insert(jobsOutbox).values({
    id: outboxId,
    tenantId: project.tenantId,
    jobType: "common_push",
    payload: { projectId },
    status: "pending",
    availableAt: new Date(Date.now() + COMMON_PUSH_DELAY_MS),
  });
  const added = await addHubJob(
    "common_push",
    { outboxId, projectId },
    { jobId, delayMs: COMMON_PUSH_DELAY_MS },
  );
  if (!added) {
    await db.delete(jobsOutbox).where(eq(jobsOutbox.id, outboxId));
  }
}

export async function releaseDeferredAutoSync(db: Db, redis: Redis, workspaceId: string) {
  if (await workspaceBusy(db, workspaceId)) return;
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace || (workspace.status !== "ready" && workspace.status !== "idle")) return;
  const queued = await db
    .select()
    .from(applyJobs)
    .where(
      and(
        eq(applyJobs.workspaceId, workspaceId),
        eq(applyJobs.status, "queued"),
        eq(applyJobs.trigger, "publish"),
        eq(applyJobs.kind, "config"),
      ),
    );
  for (const job of queued) {
    const [out] = await db.select().from(jobsOutbox).where(eq(jobsOutbox.id, job.id)).limit(1);
    if (!out || (out.status !== "pending" && out.status !== "failed")) continue;
    const payload = out.payload as ApplyPayload;
    if (!payload.deferUntilIdle) continue;
    const delayMs = await reserveAutoSyncDelay(redis, workspace.projectId);
    await addHubJob("apply", { outboxId: out.id, applyJobId: job.id }, { jobId: out.id, delayMs });
  }
}

async function replayOutbox(db: Db) {
  const rows = await db
    .select()
    .from(jobsOutbox)
    .where(inArray(jobsOutbox.status, ["pending", "failed"]))
    .limit(200);
  for (const row of rows) {
    if (row.status === "failed" && row.attempts >= 3) continue;
    const payload = row.payload as ApplyPayload & { projectId?: string };
    if (row.jobType === "apply" && payload.applyJobId) {
      if (payload.deferUntilIdle && payload.workspaceId && (await workspaceBusy(db, payload.workspaceId))) {
        continue;
      }
      if (row.availableAt.getTime() > Date.now()) continue;
      await addHubJob(
        "apply",
        { outboxId: row.id, applyJobId: payload.applyJobId },
        { jobId: row.id },
      );
    } else if (row.jobType === "common_push" && payload.projectId) {
      if (row.availableAt.getTime() > Date.now()) continue;
      await addHubJob(
        "common_push",
        { outboxId: row.id, projectId: payload.projectId },
        { jobId: `common-${payload.projectId}` },
      );
    }
  }
}

export async function startAutoSync(next: AutoSyncDeps) {
  deps = next;
  setHubJobHandler(handleJob);
  await startHubJobs();
  await replayOutbox(next.db);
}

export async function stopAutoSync() {
  deps = null;
  await stopHubJobs();
}
