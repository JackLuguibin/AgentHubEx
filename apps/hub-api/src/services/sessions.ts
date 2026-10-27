import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import {
  agentSessions,
  projectCredentials,
  projectIssues,
  projectRuntimeBindings,
  projects,
  runtimeInstances,
  userCredentials,
  workspaces,
} from "@agenthub/db";
import { can, effectiveProjectRole, type ProjectRole } from "@agenthub/auth";
import type { AgentSession, CreateSessionReqSchema } from "@agenthub/domain";
import { opencodeAdapter } from "@agenthub/adapter-opencode";
import { DEFAULT_CAPABILITIES, type InstanceCtx } from "@agenthub/runtime-contract";
import type { z } from "zod";
import { AppError, conflict, forbidden, notFound } from "../errors.js";
import { applySessionIssueLink, prepareSessionIssue } from "./issues.js";
import { recordAudit } from "../lib/audit.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { newId } from "../lib/id.js";
import { toIso } from "../lib/time.js";
import { assertInstanceHealthyForConfig } from "./instances.js";
import { resolveProjectAccess } from "./projects.js";
import { assertTenantActive } from "./tenants.js";

type CreateSessionInput = z.infer<typeof CreateSessionReqSchema>;

type CredRef = {
  source: "user" | "project";
  id: string;
  label: string;
  version: number;
};

async function requireSessionAccess(
  db: Db,
  sessionId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);
  if (!row || row.status === "archived") throw notFound("Session not found");

  const access = await resolveProjectAccess(db, row.projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "session.own", { isPlatformAdmin })) {
    throw forbidden();
  }
  if (row.ownerUserId !== userId && !isPlatformAdmin) {
    throw notFound("Session not found");
  }
  return { row, access };
}

function projectCredAllowed(
  allowedRoles: string[] | null,
  role: ProjectRole | null,
  canUseProject: boolean,
) {
  return Boolean(canUseProject && role && (allowedRoles ?? []).includes(role));
}

async function resolveCredential(
  db: Db,
  projectId: string,
  userId: string,
  policy: string,
  role: ProjectRole | null,
  canUseProject: boolean,
  input: CreateSessionInput,
): Promise<CredRef> {
  if (input.credentialId && input.credentialSource) {
    if (input.credentialSource === "user") {
      const [uc] = await db
        .select()
        .from(userCredentials)
        .where(
          and(
            eq(userCredentials.id, input.credentialId),
            eq(userCredentials.userId, userId),
          ),
        )
        .limit(1);
      if (!uc || uc.status !== "active") throw notFound("Credential not found");
      if (policy === "project_only") {
        throw new AppError(409, "CONFLICT", "User credentials not allowed by policy", {
          details: { code: "CREDENTIAL_POLICY_VIOLATION" },
        });
      }
      return {
        source: "user",
        id: uc.id,
        label: uc.label,
        version: uc.currentVersion,
      };
    }
    const [pc] = await db
      .select()
      .from(projectCredentials)
      .where(
        and(
          eq(projectCredentials.id, input.credentialId),
          eq(projectCredentials.projectId, projectId),
        ),
      )
      .limit(1);
    if (!pc || pc.status !== "active") throw notFound("Credential not found");
    if (policy === "user_only") {
      throw new AppError(409, "CONFLICT", "Project credentials not allowed by policy", {
        details: { code: "CREDENTIAL_POLICY_VIOLATION" },
      });
    }
    if (!projectCredAllowed(pc.allowedRoles, role, canUseProject)) {
      throw new AppError(409, "CONFLICT", "Project credential is not allowed for this role", {
        details: { code: "CREDENTIAL_POLICY_VIOLATION" },
      });
    }
    return {
      source: "project",
      id: pc.id,
      label: pc.label,
      version: pc.currentVersion,
    };
  }

  // Auto-pick: default project cred → first user cred
  if (policy !== "user_only") {
    const [pc] = await db
      .select()
      .from(projectCredentials)
      .where(
        and(
          eq(projectCredentials.projectId, projectId),
          eq(projectCredentials.status, "active"),
          eq(projectCredentials.isDefault, true),
        ),
      )
      .limit(1);
    if (pc && projectCredAllowed(pc.allowedRoles, role, canUseProject)) {
      return {
        source: "project",
        id: pc.id,
        label: pc.label,
        version: pc.currentVersion,
      };
    }
  }
  if (policy !== "project_only") {
    const [uc] = await db
      .select()
      .from(userCredentials)
      .where(
        and(eq(userCredentials.userId, userId), eq(userCredentials.status, "active")),
      )
      .limit(1);
    if (uc) {
      return {
        source: "user",
        id: uc.id,
        label: uc.label,
        version: uc.currentVersion,
      };
    }
  }

  throw new AppError(409, "CONFLICT", "No usable credential", {
    details: { code: "CREDENTIAL_REQUIRED" },
  });
}

type InstanceRow = typeof runtimeInstances.$inferSelect;

/** ADR-013: a dedicated instance serves at most one (project, user) workspace. */
async function isDedicatedOccupiedByOther(
  db: Db,
  inst: InstanceRow,
  projectId: string,
  userId: string,
) {
  if (inst.isolation !== "dedicated") return false;
  const holders = await db
    .select({ projectId: workspaces.projectId, ownerUserId: workspaces.ownerUserId })
    .from(workspaces)
    .where(and(eq(workspaces.instanceId, inst.id), ne(workspaces.status, "deleted")));
  return holders.some((h) => h.projectId !== projectId || h.ownerUserId !== userId);
}

function labelsMatch(labels: unknown, selector: Record<string, string>) {
  const l = (labels ?? {}) as Record<string, string>;
  return Object.entries(selector).every(([k, v]) => l[k] === v);
}

async function ensureMockOrBoundInstance(
  db: Db,
  tenantId: string,
  projectId: string,
  userId: string,
  runtimeType: "opencode" | "claude",
  runtimeMock: boolean,
  platformDek: string,
) {
  const usable = async (inst: InstanceRow | undefined) =>
    Boolean(inst) &&
    inst!.tenantId === tenantId &&
    inst!.runtimeType === runtimeType &&
    inst!.healthStatus !== "disabled" &&
    !(await isDedicatedOccupiedByOther(db, inst!, projectId, userId));

  // Sticky: keep the instance the user's workspace already runs on.
  const [ownWs] = await db
    .select({ instanceId: workspaces.instanceId })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.projectId, projectId),
        eq(workspaces.ownerUserId, userId),
        eq(workspaces.runtimeType, runtimeType),
        ne(workspaces.status, "deleted"),
      ),
    )
    .limit(1);
  if (ownWs?.instanceId) {
    const [inst] = await db
      .select()
      .from(runtimeInstances)
      .where(eq(runtimeInstances.id, ownWs.instanceId))
      .limit(1);
    if (await usable(inst)) return inst!;
  }

  const tenantInstances = await db
    .select()
    .from(runtimeInstances)
    .where(
      and(
        eq(runtimeInstances.tenantId, tenantId),
        eq(runtimeInstances.runtimeType, runtimeType),
      ),
    );

  const bindings = await db
    .select()
    .from(projectRuntimeBindings)
    .where(
      and(
        eq(projectRuntimeBindings.projectId, projectId),
        eq(projectRuntimeBindings.runtimeType, runtimeType),
      ),
    )
    .orderBy(asc(projectRuntimeBindings.priority));

  if (bindings.length > 0) {
    for (const b of bindings) {
      const candidates = b.instanceId
        ? tenantInstances.filter((i) => i.id === b.instanceId)
        : tenantInstances.filter((i) =>
            labelsMatch(i.labels, (b.labelSelector ?? {}) as Record<string, string>),
          );
      for (const inst of candidates) {
        if (await usable(inst)) return inst;
      }
    }
    throw new AppError(409, "CONFLICT", "No bound runtime instance available", {
      details: { code: "WORKSPACE_NOT_READY" },
    });
  }

  // No explicit bindings: instances assigned to this project, or unassigned ones.
  for (const inst of tenantInstances) {
    const assigned = inst.assignedProjectIds ?? [];
    if (assigned.length > 0 && !assigned.includes(projectId)) continue;
    if (await usable(inst)) return inst;
  }

  if (!runtimeMock) {
    throw new AppError(409, "CONFLICT", "No runtime instance available", {
      details: { code: "WORKSPACE_NOT_READY" },
    });
  }

  // Create a mock external instance for local P0
  const id = newId();
  const [inst] = await db
    .insert(runtimeInstances)
    .values({
      id,
      tenantId,
      name: "local-mock-opencode",
      mode: "external",
      runtimeType,
      baseUrl: "mock://opencode",
      tlsVerify: false,
      isolation: "shared",
      labels: { mock: "true" },
      healthStatus: "healthy",
      assignedProjectIds: [projectId],
      authUsername: "mock",
      authSecretCiphertext: encryptSecret("mock-password", platformDek),
      authKeyVersion: 1,
    })
    .returning();

  await db.insert(projectRuntimeBindings).values({
    id: newId(),
    tenantId,
    projectId,
    runtimeType,
    instanceId: id,
    priority: 100,
  });

  return inst!;
}

export function toInstanceCtx(
  row: typeof runtimeInstances.$inferSelect,
  platformDek: string,
  runtimeMock: boolean,
): InstanceCtx {
  const mock = runtimeMock || row.baseUrl.startsWith("mock://");
  let auth: InstanceCtx["auth"];
  if (row.authUsername && row.authSecretCiphertext) {
    auth = {
      username: row.authUsername,
      password: decryptSecret(Buffer.from(row.authSecretCiphertext), platformDek),
    };
  }
  return {
    baseUrl: row.baseUrl,
    auth,
    tlsVerify: row.tlsVerify,
    mock,
  };
}

async function ensureWorkspace(
  db: Db,
  tenantId: string,
  projectId: string,
  userId: string,
  runtimeType: "opencode" | "claude",
  instanceId: string,
) {
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.projectId, projectId),
        eq(workspaces.ownerUserId, userId),
        eq(workspaces.runtimeType, runtimeType),
        ne(workspaces.status, "deleted"),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.status !== "ready" && existing.status !== "idle") {
      await db
        .update(workspaces)
        .set({ status: "ready", instanceId, updatedAt: new Date() })
        .where(eq(workspaces.id, existing.id));
      return { ...existing, status: "ready", instanceId };
    }
    if (existing.instanceId !== instanceId) {
      await db
        .update(workspaces)
        .set({ instanceId, updatedAt: new Date() })
        .where(eq(workspaces.id, existing.id));
      return { ...existing, instanceId };
    }
    return existing;
  }

  const id = newId();
  const [row] = await db
    .insert(workspaces)
    .values({
      id,
      tenantId,
      projectId,
      ownerUserId: userId,
      kind: "personal",
      runtimeType,
      instanceId,
      status: "ready",
      spec: {},
    })
    .returning();
  return row!;
}

async function mapSession(db: Db, row: typeof agentSessions.$inferSelect): Promise<AgentSession> {
  let credLabel = "credential";
  if (row.credentialSource === "user") {
    const [uc] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.id, row.credentialId))
      .limit(1);
    if (uc) credLabel = uc.label;
  } else {
    const [pc] = await db
      .select()
      .from(projectCredentials)
      .where(eq(projectCredentials.id, row.credentialId))
      .limit(1);
    if (pc) credLabel = pc.label;
  }

  let issue: AgentSession["issue"] = null;
  if (row.issueId) {
    const [iss] = await db
      .select()
      .from(projectIssues)
      .where(eq(projectIssues.id, row.issueId))
      .limit(1);
    if (iss) {
      const [proj] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, iss.projectId))
        .limit(1);
      issue = {
        id: iss.id,
        key: `${proj?.key ?? "ISS"}-${iss.seq}`,
        title: iss.title,
        status: iss.status as NonNullable<AgentSession["issue"]>["status"],
      };
    }
  }

  return {
    id: row.id,
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    ownerUserId: row.ownerUserId,
    title: row.title,
    runtimeType: row.runtimeType as AgentSession["runtimeType"],
    status: row.status as AgentSession["status"],
    statusReason: row.statusReason,
    credential: {
      source: row.credentialSource as "user" | "project",
      id: row.credentialId,
      label: credLabel,
      version: row.credentialVersion,
    },
    model: row.model,
    agent: row.agent,
    issue,
    branch: null,
    usage: {
      inputTokens: row.usageInputTokens,
      outputTokens: row.usageOutputTokens,
    },
    lastMessageAt: toIso(row.lastMessageAt),
    createdAt: toIso(row.createdAt)!,
  };
}

export async function listMySessions(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
  filters?: { status?: string; issueId?: string },
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "session.own", { isPlatformAdmin })) {
    throw forbidden();
  }
  await assertTenantActive(db, access.project.tenantId);

  const conditions = [
    eq(agentSessions.projectId, projectId),
    eq(agentSessions.ownerUserId, userId),
    ne(agentSessions.status, "archived"),
  ];
  if (filters?.status) conditions.push(eq(agentSessions.status, filters.status));
  if (filters?.issueId) conditions.push(eq(agentSessions.issueId, filters.issueId));

  const rows = await db
    .select()
    .from(agentSessions)
    .where(and(...conditions))
    .orderBy(desc(agentSessions.createdAt))
    .limit(50);

  return {
    items: await Promise.all(rows.map((r) => mapSession(db, r))),
    nextCursor: null as string | null,
  };
}

export async function createSession(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  runtimeMock: boolean,
  input: CreateSessionInput,
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "session.create", { isPlatformAdmin })) {
    throw forbidden();
  }
  await assertTenantActive(db, access.project.tenantId);
  if (access.project.archivedAt) {
    throw new AppError(409, "PROJECT_ARCHIVED", "Project is archived");
  }

  const projectSettings = (access.project.settings ?? {}) as {
    defaultRuntimeType?: "opencode" | "claude";
  };
  const runtimeType =
    input.runtimeType ?? projectSettings.defaultRuntimeType ?? "opencode";
  if (runtimeType !== "opencode") {
    throw conflict("Only opencode runtime is supported in P0");
  }

  const role = effectiveProjectRole(access.projectRole, access.tenantRole);
  const canUseProject = can(access.projectRole, access.tenantRole, "credential.project.use", {
    isPlatformAdmin,
  });
  const cred = await resolveCredential(
    db,
    projectId,
    userId,
    access.project.credentialPolicy,
    role,
    canUseProject,
    input,
  );

  const instance = await ensureMockOrBoundInstance(
    db,
    access.project.tenantId,
    projectId,
    userId,
    runtimeType,
    runtimeMock,
    platformDek,
  );
  const workspace = await ensureWorkspace(
    db,
    access.project.tenantId,
    projectId,
    userId,
    runtimeType,
    instance.id,
  );

  const linkedIssue = input.issueId
    ? await prepareSessionIssue(db, projectId, input.issueId)
    : null;

  const ctx = toInstanceCtx(instance, platformDek, runtimeMock);
  const { ref } = await opencodeAdapter.createSession(ctx, {
    title: input.title,
    agent: input.agent,
  });

  const id = newId();
  let title = input.title?.trim() || (linkedIssue ? `${linkedIssue.key} · ${linkedIssue.title}` : "新会话");
  if (linkedIssue && !title.includes(linkedIssue.key)) {
    title = `${linkedIssue.key} · ${title}`;
  }
  title = title.slice(0, 200);
  const [row] = await db
    .insert(agentSessions)
    .values({
      id,
      tenantId: access.project.tenantId,
      projectId,
      workspaceId: workspace.id,
      ownerUserId: userId,
      title,
      runtimeType,
      runtimeSessionRef: ref,
      credentialSource: cred.source,
      credentialId: cred.id,
      credentialVersion: cred.version,
      issueId: input.issueId,
      status: "active",
      model: input.model,
      agent: input.agent,
    })
    .returning();

  if (linkedIssue) {
    await applySessionIssueLink(db, linkedIssue.id, userId);
  }

  const session = await mapSession(db, row!);

  if (input.initialPrompt) {
    await sendMessage(
      db,
      id,
      userId,
      isPlatformAdmin,
      platformDek,
      runtimeMock,
      { parts: [{ type: "text", text: input.initialPrompt }] },
    );
  }

  return session;
}

export async function getSession(
  db: Db,
  sessionId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const { row } = await requireSessionAccess(db, sessionId, userId, isPlatformAdmin);
  return mapSession(db, row);
}

export async function patchSession(
  db: Db,
  sessionId: string,
  userId: string,
  isPlatformAdmin: boolean,
  input: { title: string },
) {
  const { row } = await requireSessionAccess(db, sessionId, userId, isPlatformAdmin);
  const [updated] = await db
    .update(agentSessions)
    .set({ title: input.title, updatedAt: new Date() })
    .where(eq(agentSessions.id, row.id))
    .returning();
  return mapSession(db, updated!);
}

export async function archiveSession(
  db: Db,
  sessionId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const { row } = await requireSessionAccess(db, sessionId, userId, isPlatformAdmin);
  if (row.status === "busy") {
    throw conflict("会话忙碌中，请先停止后再归档");
  }
  await db
    .update(agentSessions)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(agentSessions.id, row.id));
}

export async function abortSession(
  db: Db,
  sessionId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  runtimeMock: boolean,
) {
  const loaded = await loadSessionRuntime(
    db,
    sessionId,
    userId,
    isPlatformAdmin,
    platformDek,
    runtimeMock,
  );
  await opencodeAdapter.abort(loaded.ctx, loaded.runtimeSessionRef);
  const [updated] = await db
    .update(agentSessions)
    .set({ status: "aborted", statusReason: "aborted", updatedAt: new Date() })
    .where(eq(agentSessions.id, sessionId))
    .returning();
  return mapSession(db, updated!);
}

export async function respondSessionPermission(
  db: Db,
  sessionId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  runtimeMock: boolean,
  reqId: string,
  decision: "allow" | "deny" | "always",
) {
  const loaded = await loadSessionRuntime(
    db,
    sessionId,
    userId,
    isPlatformAdmin,
    platformDek,
    runtimeMock,
  );
  await opencodeAdapter.respondPermission(
    loaded.ctx,
    loaded.runtimeSessionRef,
    reqId,
    decision,
  );
  recordAudit({
    action: "permission.decision",
    actorId: userId,
    tenantId: loaded.session.tenantId,
    projectId: loaded.session.projectId,
    targetType: "session",
    targetId: sessionId,
    meta: { reqId, decision },
  });
}

export async function sendMessage(
  db: Db,
  sessionId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  runtimeMock: boolean,
  input: { parts: Array<{ type: string; text?: string; path?: string; mime?: string; dataBase64?: string }>; model?: string; agent?: string },
) {
  const { row } = await requireSessionAccess(db, sessionId, userId, isPlatformAdmin);
  if (!row.runtimeSessionRef) {
    throw conflict("Session has no runtime ref");
  }

  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, row.workspaceId))
    .limit(1);
  if (!ws?.instanceId) throw conflict("Workspace not ready", { code: "WORKSPACE_NOT_READY" });

  const [inst] = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.id, ws.instanceId))
    .limit(1);
  if (!inst) throw conflict("Runtime instance missing", { code: "UPSTREAM_UNAVAILABLE" });

  const ctx = toInstanceCtx(inst, platformDek, runtimeMock);
  const messageId = newId();
  await opencodeAdapter.sendMessage(ctx, row.runtimeSessionRef, {
    parts: input.parts as never,
    model: input.model ?? row.model ?? undefined,
    agent: input.agent ?? row.agent ?? undefined,
  });

  await db
    .update(agentSessions)
    .set({
      status: "busy",
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentSessions.id, sessionId));

  return { messageId };
}

export async function getWorkspaceMe(
  db: Db,
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  runtimeMock: boolean,
  runtimeTypeOverride?: "opencode" | "claude",
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "workspace.own", { isPlatformAdmin })) {
    throw forbidden();
  }
  const projectSettings = (access.project.settings ?? {}) as {
    defaultRuntimeType?: "opencode" | "claude";
  };
  const runtimeType =
    runtimeTypeOverride ?? projectSettings.defaultRuntimeType ?? "opencode";
  const instance = await ensureMockOrBoundInstance(
    db,
    access.project.tenantId,
    projectId,
    userId,
    runtimeType,
    runtimeMock,
    platformDek,
  );
  const ws = await ensureWorkspace(
    db,
    access.project.tenantId,
    projectId,
    userId,
    runtimeType,
    instance.id,
  );

  const ctx = toInstanceCtx(instance, platformDek, runtimeMock);
  const capabilities = await opencodeAdapter.capabilities(ctx).catch(() => ({
    ...DEFAULT_CAPABILITIES,
    files: true,
    find: true,
    streaming: true,
    abort: true,
    permissions: true,
  }));

  const status =
    instance.healthStatus === "healthy" || instance.healthStatus === "degraded"
      ? instance.healthStatus === "degraded"
        ? "ready_degraded"
        : ws.status === "ready" || ws.status === "idle"
          ? ws.status
          : "ready"
      : instance.healthStatus === "pending"
        ? "provisioning"
        : "unavailable";

  return {
    id: ws.id,
    projectId: ws.projectId,
    ownerUserId: ws.ownerUserId,
    runtimeType: ws.runtimeType as "opencode" | "claude",
    status,
    statusReason:
      status === "unavailable"
        ? `instance health=${instance.healthStatus}`
        : null,
    mode: instance.mode as "external" | "managed",
    instance: {
      id: instance.id,
      name: instance.name,
      health: instance.healthStatus as
        | "pending"
        | "healthy"
        | "degraded"
        | "unhealthy"
        | "disabled",
    },
    capabilities,
    createdAt: toIso(ws.createdAt)!,
  };
}

export async function syncWorkspaceConfig(
  db: Db,
  workspaceId: string,
  userId: string,
  isPlatformAdmin: boolean,
) {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), ne(workspaces.status, "deleted")))
    .limit(1);
  if (!ws) throw notFound("Workspace not found");
  if (ws.ownerUserId !== userId && !isPlatformAdmin) throw notFound("Workspace not found");

  const access = await resolveProjectAccess(db, ws.projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "workspace.own", { isPlatformAdmin })) {
    throw forbidden();
  }
  if (!ws.instanceId) {
    throw conflict("Workspace has no runtime instance", { code: "WORKSPACE_NOT_READY" });
  }

  await assertInstanceHealthyForConfig(db, ws.instanceId);

  // Config Apply pipeline lands in a later P1 handbook; gate only.
  return {
    id: newId(),
    workspaceId,
    status: "queued" as const,
    kind: "apply_config" as const,
    message: "Config apply accepted (bundle pipeline pending)",
  };
}

export async function loadSessionRuntime(
  db: Db,
  sessionId: string,
  userId: string,
  isPlatformAdmin: boolean,
  platformDek: string,
  runtimeMock: boolean,
) {
  const { row } = await requireSessionAccess(db, sessionId, userId, isPlatformAdmin);
  if (!row.runtimeSessionRef) throw conflict("Session has no runtime ref");

  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, row.workspaceId))
    .limit(1);
  if (!ws?.instanceId) throw conflict("Workspace not ready");

  const [inst] = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.id, ws.instanceId))
    .limit(1);
  if (!inst) throw conflict("Runtime instance missing");

  return {
    session: row,
    ctx: toInstanceCtx(inst, platformDek, runtimeMock),
    runtimeSessionRef: row.runtimeSessionRef,
  };
}

export { requireSessionAccess };
