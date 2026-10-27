import { z } from "zod";

export const UuidSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime();

export const TenantRoleSchema = z.enum(["owner", "admin", "member"]);
export const ProjectRoleSchema = z.enum(["owner", "developer", "viewer"]);
export const TenantStatusSchema = z.enum(["active", "suspended"]);
export const CredentialPolicySchema = z.enum([
  "user_or_project",
  "project_only",
  "user_only",
]);
export const RuntimeTypeSchema = z.enum(["opencode", "claude"]);
export const ProviderSchema = z.enum(["anthropic", "openai", "opencode", "custom"]);
export const CredentialStatusSchema = z.enum(["active", "disabled", "expired"]);
export const IssueStatusSchema = z.enum([
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
]);
export const IssuePrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export const InstanceHealthSchema = z.enum([
  "pending",
  "healthy",
  "degraded",
  "unhealthy",
  "disabled",
]);

export const ErrorResSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.unknown()).optional(),
    fieldErrors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional(),
  }),
});

export const RegisterReqSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(128),
  displayName: z.string().min(1).max(64),
  handle: z.string().regex(/^[a-z0-9-]{2,32}$/),
});

export const LoginReqSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(128),
});

export const MeSchema = z.object({
  id: UuidSchema,
  email: z.string().email(),
  displayName: z.string(),
  handle: z.string(),
  isPlatformAdmin: z.boolean(),
  currentTenantId: UuidSchema.nullable(),
  tenants: z.array(
    z.object({
      id: UuidSchema,
      slug: z.string(),
      name: z.string(),
      role: TenantRoleSchema,
      status: TenantStatusSchema,
    }),
  ),
});

export const LoginResSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: MeSchema,
});

export const SwitchTenantReqSchema = z.object({
  tenantId: UuidSchema,
});

export const TenantQuotaSchema = z.object({
  maxConcurrentSessionsPerUser: z.number().int().default(5),
  maxActiveWorkspaces: z.number().int().default(50),
  tokensPerDay: z.number().int().optional(),
});

export const TenantSchema = z.object({
  id: UuidSchema,
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}$/),
  name: z.string().min(1),
  status: TenantStatusSchema,
  quota: TenantQuotaSchema,
  settings: z.object({
    allowedLoginMethods: z.array(z.string()).default(["password"]),
    defaultModel: z.string().optional(),
  }),
  createdAt: TimestampSchema,
});

export const CreateTenantReqSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}$/),
  name: z.string().min(1).max(128),
  ownerEmail: z.string().email(),
});

export const PatchTenantReqSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  quota: TenantQuotaSchema.partial().optional(),
  settings: z
    .object({
      allowedLoginMethods: z.array(z.string()).optional(),
      defaultModel: z.string().optional(),
    })
    .optional(),
});

export const TenantMemberSchema = z.object({
  userId: UuidSchema,
  email: z.string().email(),
  displayName: z.string(),
  role: TenantRoleSchema,
  joinedAt: TimestampSchema,
});

export const AddTenantMemberReqSchema = z.object({
  email: z.string().email(),
  role: TenantRoleSchema,
});

export const PatchTenantMemberReqSchema = z.object({
  role: TenantRoleSchema,
});

export const ProjectSettingsSchema = z.object({
  strictConfig: z.boolean().default(false),
  promoteRequiresReview: z.boolean().default(true),
  allowSharedPush: z.boolean().default(false),
  workspaceSpec: z
    .object({
      cpu: z.number().default(2),
      memMb: z.number().default(4096),
      diskGb: z.number().default(20),
    })
    .default({ cpu: 2, memMb: 4096, diskGb: 20 }),
  defaultRuntimeType: RuntimeTypeSchema.default("opencode"),
  issuePromptTemplate: z.string().optional(),
  allowedProviderHosts: z.array(z.string()).optional(),
});

export const ProjectSchema = z.object({
  id: UuidSchema,
  tenantId: UuidSchema,
  key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  name: z.string().min(1),
  description: z.string().optional(),
  credentialPolicy: CredentialPolicySchema,
  commonSyncPolicy: z.enum(["on_workspace_start", "on_common_publish"]),
  settings: ProjectSettingsSchema,
  myRole: ProjectRoleSchema.nullable(),
  archivedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  etag: z.string(),
});

export const CreateProjectReqSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  name: z.string().min(1).max(128),
  description: z.string().max(2000).optional(),
  credentialPolicy: CredentialPolicySchema.optional(),
  settings: ProjectSettingsSchema.partial().optional(),
});

export const PatchProjectReqSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(2000).nullable().optional(),
  credentialPolicy: CredentialPolicySchema.optional(),
  commonSyncPolicy: z.enum(["on_workspace_start", "on_common_publish"]).optional(),
  settings: ProjectSettingsSchema.partial().optional(),
});

export const ProjectMemberSchema = z.object({
  userId: UuidSchema,
  email: z.string().email(),
  displayName: z.string(),
  role: ProjectRoleSchema,
});

export const AddProjectMemberReqSchema = z.object({
  userId: UuidSchema.optional(),
  email: z.string().email().optional(),
  role: ProjectRoleSchema,
}).refine((v) => Boolean(v.userId || v.email), {
  message: "userId or email required",
});

export const PatchProjectMemberReqSchema = z.object({
  role: ProjectRoleSchema,
});

/** Invite / add a user into a tenant (and optional project grants). Reuses User by email. */
export const CreateInvitationReqSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(64).optional(),
  tenantRole: TenantRoleSchema.default("member"),
  projectGrants: z
    .array(
      z.object({
        projectId: UuidSchema,
        role: ProjectRoleSchema,
      }),
    )
    .optional(),
});

export const InvitationSchema = z.object({
  id: UuidSchema,
  email: z.string().email(),
  tenantRole: TenantRoleSchema,
  projectGrants: z.array(
    z.object({
      projectId: UuidSchema,
      role: ProjectRoleSchema,
    }),
  ),
  expiresAt: TimestampSchema,
  acceptedAt: TimestampSchema.nullable(),
  inviteUrl: z.string().optional(),
  reusedExistingUser: z.boolean(),
  userId: UuidSchema,
});

export const UserTenantBindingSchema = z.object({
  tenantId: UuidSchema,
  tenantName: z.string(),
  tenantSlug: z.string(),
  status: TenantStatusSchema,
  role: TenantRoleSchema,
});

export const UserProjectBindingSchema = z.object({
  projectId: UuidSchema,
  projectName: z.string(),
  projectKey: z.string(),
  tenantId: UuidSchema,
  role: ProjectRoleSchema,
  archivedAt: TimestampSchema.nullable(),
});

export const UserBindingsSchema = z.object({
  userId: UuidSchema,
  email: z.string().email(),
  displayName: z.string(),
  tenants: z.array(UserTenantBindingSchema),
  projects: z.array(UserProjectBindingSchema),
});

export const DirectoryUserSchema = z.object({
  userId: UuidSchema,
  email: z.string().email(),
  displayName: z.string(),
  tenants: z.array(UserTenantBindingSchema),
  projects: z.array(UserProjectBindingSchema),
});

export const PutUserBindingsReqSchema = z.object({
  /** Desired memberships for tenants the actor can manage. Omitted manageable tenants are unbound. */
  tenants: z.array(
    z.object({
      tenantId: UuidSchema,
      role: TenantRoleSchema,
      projects: z.array(
        z.object({
          projectId: UuidSchema,
          role: ProjectRoleSchema,
        }),
      ),
    }),
  ),
});

export const CredentialMetaSchema = z.object({
  baseUrl: z.string().url().optional(),
  defaultModel: z.string().optional(),
  orgId: z.string().optional(),
});

export const UserCredentialSchema = z.object({
  id: UuidSchema,
  provider: ProviderSchema,
  label: z.string(),
  metadata: CredentialMetaSchema,
  last4: z.string().nullable(),
  status: CredentialStatusSchema,
  version: z.number().int(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const ProjectCredentialSchema = UserCredentialSchema.extend({
  allowedRoles: z.array(ProjectRoleSchema),
  isDefault: z.boolean(),
});

export const UpsertCredentialReqSchema = z.object({
  provider: ProviderSchema,
  label: z.string().min(1).max(64),
  secret: z.string().min(1).optional(),
  metadata: CredentialMetaSchema.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export const UpsertProjectCredentialReqSchema = UpsertCredentialReqSchema.extend({
  allowedRoles: z.array(ProjectRoleSchema).optional(),
  isDefault: z.boolean().optional(),
});

export const RuntimeInstanceSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  mode: z.enum(["external", "managed"]),
  runtimeType: RuntimeTypeSchema,
  baseUrl: z.string().optional(),
  isolation: z.enum(["dedicated", "shared"]),
  labels: z.record(z.string()),
  health: InstanceHealthSchema,
  latencyMs: z.number().nullable(),
  upstreamVersion: z.string().nullable(),
  hasSyncAgent: z.boolean(),
  maxSessions: z.number().nullable(),
  assignedProjectIds: z.array(UuidSchema),
  boundProjectCount: z.number().int().optional(),
  workspaceCount: z.number().int().optional(),
  lastCheckedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
});

export const RegisterInstanceReqSchema = z.object({
  name: z.string().min(1).max(128),
  runtimeType: z.literal("opencode").default("opencode"),
  baseUrl: z.string().url(),
  tlsVerify: z.boolean().optional(),
  auth: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .optional(),
  isolation: z.enum(["dedicated", "shared"]).optional(),
  labels: z.record(z.string()).optional(),
  maxSessions: z.number().int().positive().optional(),
  assignedProjectIds: z.array(UuidSchema).optional(),
  workdirHint: z.string().optional(),
  enableSyncAgent: z.boolean().optional(),
});

export const TestInstanceReqSchema = RegisterInstanceReqSchema.omit({ name: true });

export const PatchInstanceReqSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  baseUrl: z.string().url().optional(),
  tlsVerify: z.boolean().optional(),
  auth: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .optional(),
  isolation: z.enum(["dedicated", "shared"]).optional(),
  labels: z.record(z.string()).optional(),
  maxSessions: z.number().int().positive().nullable().optional(),
  assignedProjectIds: z.array(UuidSchema).optional(),
  workdirHint: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export const TestInstanceResSchema = z.object({
  ok: z.boolean(),
  version: z.string().optional(),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
});

export const ProjectRuntimeBindingSchema = z.object({
  id: UuidSchema,
  runtimeType: RuntimeTypeSchema,
  instanceId: UuidSchema.optional(),
  labelSelector: z.record(z.string()).optional(),
  priority: z.number().int(),
});

export const PutProjectBindingsReqSchema = z.object({
  bindings: z.array(
    z
      .object({
        runtimeType: RuntimeTypeSchema,
        instanceId: UuidSchema.optional(),
        labelSelector: z.record(z.string()).optional(),
        priority: z.number().int().default(100),
      })
      .refine((b) => Boolean(b.instanceId) !== Boolean(b.labelSelector), {
        message: "exactly one of instanceId or labelSelector required",
      }),
  ),
});

export const IssueSchema = z.object({
  id: UuidSchema,
  key: z.string(),
  projectId: UuidSchema,
  title: z.string().min(1).max(200),
  description: z.string(),
  priority: IssuePrioritySchema,
  status: IssueStatusSchema,
  assignee: z
    .object({
      id: UuidSchema,
      displayName: z.string(),
    })
    .nullable(),
  labels: z.array(z.string()),
  rank: z.string(),
  resolutionNote: z.string().nullable(),
  createdBy: UuidSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  etag: z.string(),
});

export const CreateIssueReqSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(65536).optional(),
  priority: IssuePrioritySchema.optional(),
  labels: z.array(z.string().min(1).max(32)).max(20).optional(),
  assigneeUserId: UuidSchema.optional(),
  status: z.enum(["todo", "in_progress"]).optional(),
});

export const UpdateIssueReqSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(65536).optional(),
  priority: IssuePrioritySchema.optional(),
  labels: z.array(z.string().min(1).max(32)).max(20).optional(),
  assigneeUserId: UuidSchema.nullable().optional(),
  status: IssueStatusSchema.optional(),
  resolutionNote: z.string().optional(),
});

export const PageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

export const SessionStatusSchema = z.enum([
  "creating",
  "active",
  "busy",
  "idle",
  "aborted",
  "archived",
  "failed",
]);

export const CredentialSourceSchema = z.enum(["user", "project"]);

export const CredentialOptionSchema = z.object({
  source: CredentialSourceSchema,
  id: UuidSchema,
  label: z.string(),
  provider: ProviderSchema,
  isDefault: z.boolean(),
});

export const CredentialOptionsResSchema = z.object({
  policy: CredentialPolicySchema,
  defaultChoice: z
    .object({
      source: CredentialSourceSchema,
      id: UuidSchema,
    })
    .nullable(),
  options: z.array(CredentialOptionSchema),
});

export const AgentSessionSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  workspaceId: UuidSchema,
  ownerUserId: UuidSchema,
  title: z.string(),
  runtimeType: RuntimeTypeSchema,
  status: SessionStatusSchema,
  statusReason: z.string().nullable(),
  credential: z.object({
    source: CredentialSourceSchema,
    id: UuidSchema,
    label: z.string(),
    version: z.number().int(),
  }),
  model: z.string().nullable(),
  agent: z.string().nullable(),
  issue: z
    .object({
      id: UuidSchema,
      key: z.string(),
      title: z.string(),
      status: IssueStatusSchema,
    })
    .nullable(),
  branch: z
    .object({
      repoId: UuidSchema,
      branch: z.string(),
      baseBranch: z.string(),
      prUrl: z.string().nullable(),
    })
    .nullable(),
  usage: z.object({
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
  }),
  lastMessageAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
});

export const CreateSessionReqSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  runtimeType: RuntimeTypeSchema.optional(),
  credentialSource: CredentialSourceSchema.optional(),
  credentialId: UuidSchema.optional(),
  issueId: UuidSchema.optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
  initialPrompt: z.string().max(32_000).optional(),
});

export const MessagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("file"), path: z.string() }),
  z.object({
    type: z.literal("image"),
    mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
    dataBase64: z.string(),
  }),
]);

export const SendMessageReqSchema = z.object({
  parts: z.array(MessagePartSchema).min(1).max(20),
  model: z.string().optional(),
  agent: z.string().optional(),
});

export const SendMessageResSchema = z.object({
  messageId: z.string(),
});

export const SessionMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.unknown()),
  model: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
    })
    .optional(),
  createdAt: TimestampSchema,
  completedAt: TimestampSchema.optional(),
});

export const WorkspaceSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  ownerUserId: UuidSchema,
  runtimeType: RuntimeTypeSchema,
  status: z.string(),
  statusReason: z.string().nullable().optional(),
  mode: z.enum(["external", "managed"]).optional(),
  instance: z
    .object({
      id: UuidSchema,
      name: z.string(),
      health: InstanceHealthSchema,
    })
    .nullable()
    .optional(),
  capabilities: z.object({
    v: z.literal(1),
    files: z.boolean(),
    find: z.boolean(),
    lsp: z.boolean(),
    pty: z.boolean(),
    mcpRuntimeAdd: z.boolean(),
    permissions: z.boolean(),
    streaming: z.boolean(),
    abort: z.boolean(),
    usage: z.boolean(),
  }),
  createdAt: TimestampSchema,
});

export type Me = z.infer<typeof MeSchema>;
export type Tenant = z.infer<typeof TenantSchema>;
export type TenantMember = z.infer<typeof TenantMemberSchema>;
export type CreateTenantReq = z.infer<typeof CreateTenantReqSchema>;
export type PatchTenantReq = z.infer<typeof PatchTenantReqSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type CreateProjectReq = z.infer<typeof CreateProjectReqSchema>;
export type PatchProjectReq = z.infer<typeof PatchProjectReqSchema>;
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;
export type CreateInvitationReq = z.infer<typeof CreateInvitationReqSchema>;
export type Invitation = z.infer<typeof InvitationSchema>;
export type UserBindings = z.infer<typeof UserBindingsSchema>;
export type DirectoryUser = z.infer<typeof DirectoryUserSchema>;
export type PutUserBindingsReq = z.infer<typeof PutUserBindingsReqSchema>;
export type Issue = z.infer<typeof IssueSchema>;
export type UserCredential = z.infer<typeof UserCredentialSchema>;
export type ProjectCredential = z.infer<typeof ProjectCredentialSchema>;
export type RuntimeInstance = z.infer<typeof RuntimeInstanceSchema>;
export type RegisterInstanceReq = z.infer<typeof RegisterInstanceReqSchema>;
export type TestInstanceReq = z.infer<typeof TestInstanceReqSchema>;
export type PatchInstanceReq = z.infer<typeof PatchInstanceReqSchema>;
export type TestInstanceRes = z.infer<typeof TestInstanceResSchema>;
export type ProjectRuntimeBinding = z.infer<typeof ProjectRuntimeBindingSchema>;
export type PutProjectBindingsReq = z.infer<typeof PutProjectBindingsReqSchema>;
export type AgentSession = z.infer<typeof AgentSessionSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type CredentialOptionsRes = z.infer<typeof CredentialOptionsResSchema>;
