import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import {
  agentSessions,
  projectCredentials,
  projectIssues,
  projectRuntimeBindings,
  projects,
  runtimeInstances,
  tenants,
  userCredentials,
  workspaces,
} from "@agenthub/db";
import { can, effectiveProjectRole, signLlmProxyToken, type ProjectRole } from "@agenthub/auth";
import type { AgentSession, CreateSessionReqSchema } from "@agenthub/domain";
import { DEFAULT_CAPABILITIES, capabilitiesForRuntime, type InstanceCtx } from "@agenthub/runtime-contract";
import { adapterFor } from "./runtime-adapter.js";
import type { z } from "zod";
import { AppError, conflict, forbidden, notFound } from "../errors.js";
import { applySessionIssueLink, prepareSessionIssue } from "./issues.js";
import { recordAudit, rethrowAccessDenied } from "../lib/audit.js";
import { credentialSourceAllowed } from "../lib/credential-policy.js";
import { openNodeSecret, sealNodeSecret } from "../lib/envelope.js";
import type { HubRuntime } from "../lib/hub-runtime.js";
import { allowedHostsOf, assertProviderHostAllowed } from "../lib/provider-hosts.js";
import { assertDailyTokenQuota, tokensPerDayOf } from "../lib/token-quota.js";
import { tenantAllowsPty } from "../lib/agent-allowlist.js";
import { newId } from "../lib/id.js";
import { toIso } from "../lib/time.js";
import { assertInstanceHealthyForConfig } from "./instances.js";
import { provisionManagedWorkspace, resolveManagedDecision, startOwnedWorkspace } from "./scheduler.js";
import { assertSessionQuota, assertWorkspaceQuota, quotaNumber, workspaceLimitOf } from "./quotas.js";
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

  let access;
  try {
    access = await resolveProjectAccess(db, row.projectId, userId, isPlatformAdmin);
  } catch (err) {
    rethrowAccessDenied(err, {
      actorId: userId,
      tenantId: row.tenantId,
      projectId: row.projectId,
      targetType: "session",
      targetId: row.id,
      meta: { reason: "not_member" },
    });
  }
  if (!can(access.projectRole, access.tenantRole, "session.own", { isPlatformAdmin })) {
    recordAudit({
      action: "access.denied",
      actorId: userId,
      tenantId: row.tenantId,
      projectId: row.projectId,
      targetType: "session",
      targetId: row.id,
      meta: { reason: "forbidden" },
    });
    throw forbidden();
  }
  if (row.ownerUserId !== userId && !isPlatformAdmin) {
    recordAudit({
      action: "access.denied",
      actorId: userId,
      tenantId: row.tenantId,
      projectId: row.projectId,
      targetType: "session",
      targetId: row.id,
      meta: { reason: "not_owner" },
    });
    throw notFound("Session not found");
  }
  return { row, access };
}

function enforceCredentialHost(metadata: unknown, allowedHosts: string[] | undefined) {
  const baseUrl =
    metadata && typeof metadata === "object" && "baseUrl" in metadata
      ? (metadata as { baseUrl?: string }).baseUrl
      : undefined;
  assertProviderHostAllowed(baseUrl, allowedHosts);
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
  allowedHosts: string[] | undefined,
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
      if (!credentialSourceAllowed(policy as "user_or_project" | "project_only" | "user_only", "user")) {
        throw new AppError(409, "CREDENTIAL_POLICY_VIOLATION", "User credentials are not allowed by credentialPolicy", {
          details: { policy },
        });
      }
      enforceCredentialHost(uc.metadata, allowedHosts);
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
    if (!credentialSourceAllowed(policy as "user_or_project" | "project_only" | "user_only", "project")) {
      throw new AppError(409, "CREDENTIAL_POLICY_VIOLATION", "Project credentials are not allowed by credentialPolicy", {
        details: { policy },
      });
    }
    if (!projectCredAllowed(pc.allowedRoles, role, canUseProject)) {
      throw new AppError(409, "CREDENTIAL_POLICY_VIOLATION", "Project credential is not allowed for this role", {
        details: { policy },
      });
    }
    enforceCredentialHost(pc.metadata, allowedHosts);
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
      enforceCredentialHost(pc.metadata, allowedHosts);
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
      enforceCredentialHost(uc.metadata, allowedHosts);
      return {
        source: "user",
        id: uc.id,
        label: uc.label,
        version: uc.currentVersion,
      };
    }
  }

  throw new AppError(409, "CREDENTIAL_REQUIRED", "No usable credential");
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
  const sealed = await sealNodeSecret("mock-password", tenantId, id, platformDek);
  const [inst] = await db
    .insert(runtimeInstances)
    .values({
      id,
      tenantId,
      name: `local-mock-${runtimeType}`,
      mode: "external",
      runtimeType,
      baseUrl: `mock://${runtimeType}`,
      tlsVerify: false,
      isolation: "shared",
      labels: { mock: "true" },
      healthStatus: "healthy",
      assignedProjectIds: [projectId],
      authUsername: "mock",
      authSecretCiphertext: sealed.blob,
      authKeyVersion: sealed.keyVersion,
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

export async function toInstanceCtx(
  row: typeof runtimeInstances.$inferSelect,
  platformDek: string,
  runtimeMock: boolean,
): Promise<InstanceCtx> {
  const mock = runtimeMock || row.baseUrl.startsWith("mock://");
  let auth: InstanceCtx["auth"];
  if (row.authUsername && row.authSecretCiphertext && row.tenantId) {
    auth = {
      username: row.authUsername,
      password: await openNodeSecret(
        Buffer.from(row.authSecretCiphertext),
        row.tenantId,
        row.id,
        platformDek,
      ),
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
  workspaceQuota: number,
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
    const now = new Date();
    if (existing.status !== "ready") {
      await db
        .update(workspaces)
        .set({ status: "ready", instanceId, lastActiveAt: now, updatedAt: now })
        .where(eq(workspaces.id, existing.id));
      return { ...existing, status: "ready", instanceId, lastActiveAt: now };
    }
    await db
      .update(workspaces)
      .set({
        lastActiveAt: now,
        updatedAt: now,
        ...(existing.instanceId !== instanceId ? { instanceId } : {}),
      })
      .where(eq(workspaces.id, existing.id));
    return { ...existing, instanceId, lastActiveAt: now };
  }

  await assertWorkspaceQuota(db, tenantId, workspaceQuota);
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
      lastActiveAt: new Date(),
    })
    .returning();
  return row!;
}

async function placeWorkspace(
  db: Db,
  runtime: HubRuntime,
  input: {
    tenantId: string;
    projectId: string;
    userId: string;
    runtimeType: "opencode" | "claude";
    settings: unknown;
    platformDek: string;
    runtimeMock: boolean;
  },
) {
  const decided = await resolveManagedDecision(db, input.projectId, input.runtimeType, input.settings);
  if (decided.decision.managed) {
    return provisionManagedWorkspace(db, runtime, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      userId: input.userId,
      runtimeType: input.runtimeType,
      selector: decided.decision.selector,
      spec: decided.spec,
    });
  }
  const instance = await ensureMockOrBoundInstance(
    db,
    input.tenantId,
    input.projectId,
    input.userId,
    input.runtimeType,
    input.runtimeMock,
    input.platformDek,
  );
  const workspace = await ensureWorkspace(
    db,
    input.tenantId,
    input.projectId,
    input.userId,
    input.runtimeType,
    instance.id,
    await workspaceLimitOf(db, input.tenantId),
  );
  return { instance, workspace };
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
  input: CreateSessionInput,
  runtime: HubRuntime,
) {
  const access = await resolveProjectAccess(db, projectId, userId, isPlatformAdmin);
  if (!can(access.projectRole, access.tenantRole, "session.create", { isPlatformAdmin })) {
    throw forbidden();
  }
  const tenant = await assertTenantActive(db, access.project.tenantId);
  if (access.project.archivedAt) {
    throw new AppError(409, "PROJECT_ARCHIVED", "Project is archived");
  }
  await assertDailyTokenQuota(runtime.redis, tenant.id, tokensPerDayOf(tenant.quota));
  await assertSessionQuota(
    db,
    tenant.id,
    userId,
    quotaNumber(tenant.quota, "maxConcurrentSessionsPerUser", 5),
  );

  const projectSettings = (access.project.settings ?? {}) as {
    defaultRuntimeType?: "opencode" | "claude";
  };
  const runtimeType =
    input.runtimeType ?? projectSettings.defaultRuntimeType ?? "opencode";

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
    allowedHostsOf(access.project.settings),
  );

  const placed = await placeWorkspace(db, runtime, {
    tenantId: access.project.tenantId,
    projectId,
    userId,
    runtimeType,
    settings: access.project.settings,
    platformDek: runtime.platformDek,
    runtimeMock: runtime.runtimeMock,
  });
  const instance = placed.instance;
  const workspace = placed.workspace;

  const linkedIssue = input.issueId
    ? await prepareSessionIssue(db, projectId, input.issueId)
    : null;

  const ctx = await toInstanceCtx(instance, runtime.platformDek, runtime.runtimeMock);
  const { ref } = await adapterFor(runtimeType).createSession(ctx, {
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
      { parts: [{ type: "text", text: input.initialPrompt }] },
      runtime,
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
  await adapterFor(loaded.session.runtimeType).abort(loaded.ctx, loaded.runtimeSessionRef);
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
  await adapterFor(loaded.session.runtimeType).respondPermission(
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

async function injectLlmProxy(
  db: Db,
  row: typeof agentSessions.$inferSelect,
  ctx: InstanceCtx,
  runtime: HubRuntime,
) {
  if (!row.runtimeSessionRef) return;
  const provider = await providerName(db, row.credentialSource, row.credentialId);
  const token = await signLlmProxyToken(
    {
      sub: row.ownerUserId,
      sid: row.id,
      wid: row.workspaceId,
      tid: row.tenantId,
      pid: row.projectId,
    },
    runtime.llmProxySecret,
  );
  const baseUrl = `${runtime.publicBaseUrl.replace(/\/$/, "")}/llm/${provider}`;
  const adapter = adapterFor(row.runtimeType);
  if (!adapter.setCredential) return;
  await adapter.setCredential(ctx, { provider, secret: token, baseUrl }, { sessionRef: row.runtimeSessionRef });
}

async function providerName(db: Db, source: string, credentialId: string) {
  if (source === "user") {
    const [cred] = await db
      .select({ provider: userCredentials.provider })
      .from(userCredentials)
      .where(eq(userCredentials.id, credentialId))
      .limit(1);
    if (!cred) throw new AppError(409, "CREDENTIAL_REQUIRED", "Credential is not active");
    return cred.provider;
  }
  const [cred] = await db
    .select({ provider: projectCredentials.provider })
    .from(projectCredentials)
    .where(eq(projectCredentials.id, credentialId))
    .limit(1);
  if (!cred) throw new AppError(409, "CREDENTIAL_REQUIRED", "Credential is not active");
  return cred.provider;
}

export async function sendMessage(
  db: Db,
  sessionId: string,
  userId: string,
  isPlatformAdmin: boolean,
  input: { parts: Array<{ type: string; text?: string; path?: string; mime?: string; dataBase64?: string }>; model?: string; agent?: string },
  runtime: HubRuntime,
) {
  const { row, access } = await requireSessionAccess(db, sessionId, userId, isPlatformAdmin);
  const tenant = await assertTenantActive(db, access.project.tenantId);
  if (access.project.archivedAt) {
    throw new AppError(409, "PROJECT_ARCHIVED", "Project is archived");
  }
  await assertDailyTokenQuota(runtime.redis, tenant.id, tokensPerDayOf(tenant.quota));
  if (!row.runtimeSessionRef) {
    throw conflict("Session has no runtime ref");
  }

  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, row.workspaceId))
    .limit(1);
  if (!ws?.instanceId) throw conflict("Workspace not ready", { code: "WORKSPACE_NOT_READY" });
  if (ws.status === "idle" || ws.status === "stopped") {
    await startOwnedWorkspace(db, runtime, ws.id, userId, isPlatformAdmin);
  } else {
    await db
      .update(workspaces)
      .set({ lastActiveAt: new Date(), updatedAt: new Date() })
      .where(eq(workspaces.id, ws.id));
  }

  const [inst] = await db
    .select()
    .from(runtimeInstances)
    .where(eq(runtimeInstances.id, ws.instanceId))
    .limit(1);
  if (!inst) throw conflict("Runtime instance missing", { code: "UPSTREAM_UNAVAILABLE" });

  const ctx = await toInstanceCtx(inst, runtime.platformDek, runtime.runtimeMock);
  await injectLlmProxy(db, row, ctx, runtime);
  const messageId = newId();
  await adapterFor(row.runtimeType).sendMessage(ctx, row.runtimeSessionRef, {
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
  runtime: HubRuntime,
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
  const placed = await placeWorkspace(db, runtime, {
    tenantId: access.project.tenantId,
    projectId,
    userId,
    runtimeType,
    settings: access.project.settings,
    platformDek: runtime.platformDek,
    runtimeMock: runtime.runtimeMock,
  });
  const instance = placed.instance;
  const ws = placed.workspace;

  const ctx = await toInstanceCtx(instance, runtime.platformDek, runtime.runtimeMock);
  const capabilities = await adapterFor(runtimeType)
    .capabilities(ctx)
    .catch(() =>
      runtimeType === "claude"
        ? capabilitiesForRuntime("claude")
        : {
            ...DEFAULT_CAPABILITIES,
            files: true,
            find: true,
            streaming: true,
            abort: true,
            permissions: true,
          },
    );
  const [tenantRow] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, access.project.tenantId))
    .limit(1);
  const visibleCapabilities = tenantAllowsPty(tenantRow?.settings)
    ? capabilities
    : { ...capabilities, pty: false };

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
    capabilities: visibleCapabilities,
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
  if (ws.ownerUserId !== userId && !isPlatformAdmin) {
    recordAudit({
      action: "access.denied",
      actorId: userId,
      tenantId: ws.tenantId,
      projectId: ws.projectId,
      targetType: "workspace",
      targetId: ws.id,
      meta: { reason: "not_owner", surface: "sync-config" },
    });
    throw notFound("Workspace not found");
  }

  let access;
  try {
    access = await resolveProjectAccess(db, ws.projectId, userId, isPlatformAdmin);
  } catch (err) {
    rethrowAccessDenied(err, {
      actorId: userId,
      tenantId: ws.tenantId,
      projectId: ws.projectId,
      targetType: "workspace",
      targetId: ws.id,
      meta: { reason: "not_member", surface: "sync-config" },
    });
  }
  if (!can(access.projectRole, access.tenantRole, "workspace.own", { isPlatformAdmin })) {
    recordAudit({
      action: "access.denied",
      actorId: userId,
      tenantId: ws.tenantId,
      projectId: ws.projectId,
      targetType: "workspace",
      targetId: ws.id,
      meta: { reason: "forbidden", surface: "sync-config" },
    });
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
    ctx: await toInstanceCtx(inst, platformDek, runtimeMock),
    runtimeSessionRef: row.runtimeSessionRef,
  };
}

export { requireSessionAccess };
