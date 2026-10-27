import { z } from "zod";
import { ProjectRoleSchema, TimestampSchema, UuidSchema } from "./api.js";

export const RuleSchema = z.enum(["allow", "ask", "deny"]);
export const PermissionMatrixSchema = z.record(z.unknown());

export const SecretRefSchema = z.object({
  $secret: z.object({
    kind: z.enum(["projectCredential", "vault"]),
    id: z.string().min(1),
    field: z.string().min(1).optional(),
  }),
});

export const EnvValueSchema = z.union([z.string(), SecretRefSchema]);

export const AgentDefSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]{1,48}$/),
  description: z.string().min(1).max(400),
  mode: z.enum(["primary", "subagent", "all"]).optional(),
  model: z.string().min(1).optional(),
  prompt: z.string().max(100_000),
  tools: z.record(z.boolean()).optional(),
  permission: PermissionMatrixSchema.optional(),
});

export const McpDefSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9_-]{1,48}$/),
    transport: z.enum(["local", "remote"]),
    command: z.array(z.string().min(1)).optional(),
    url: z.string().min(1).optional(),
    headers: z.record(EnvValueSchema).optional(),
    env: z.record(EnvValueSchema).optional(),
    enabled: z.boolean(),
    roles: z.array(ProjectRoleSchema).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .superRefine((mcp, ctx) => {
    if (mcp.transport === "local" && (!mcp.command || mcp.command.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["command"],
        message: "local MCP requires command",
      });
    }
    if (mcp.transport === "remote" && !mcp.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "remote MCP requires url",
      });
    }
  });

export const SkillFileSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
});

export const SkillRefSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]{1,48}$/),
  files: z.array(SkillFileSchema).min(1),
});

export const ManifestSchema = z.object({
  agents: z.array(AgentDefSchema).default([]),
  mcp: z.array(McpDefSchema).default([]),
  skills: z.array(SkillRefSchema).default([]),
  instructions: z
    .object({
      agentsMd: z.string().optional(),
      extra: z.array(z.string()).optional(),
    })
    .default({}),
  permission: PermissionMatrixSchema.optional(),
  model: z.string().min(1).optional(),
  includeCommonAgentsMd: z.boolean().optional(),
});

export const BundleScopeSchema = z.enum(["platform", "tenant", "project", "user"]);

export const BundleSchema = z.object({
  id: UuidSchema,
  scope: BundleScopeSchema,
  scopeId: UuidSchema.nullable(),
  name: z.string(),
  draft: ManifestSchema,
  latestVersion: z.number().int().nullable(),
  updatedAt: TimestampSchema,
  etag: z.string(),
});

export const RevisionSchema = z.object({
  id: UuidSchema,
  bundleId: UuidSchema,
  version: z.number().int(),
  state: z.enum(["published", "archived"]),
  contentHash: z.string(),
  changelog: z.string().optional(),
  publishedBy: UuidSchema,
  publishedAt: TimestampSchema,
});

export const CreateBundleReqSchema = z.object({
  name: z.string().min(1).max(80),
});

export const PublishBundleReqSchema = z.object({
  changelog: z.string().max(2000).optional(),
});

export const RollbackBundleReqSchema = z.object({
  revisionId: UuidSchema,
});

export const ConfigLockSchema = z.object({
  lockMcp: z.boolean().default(false),
  forcedAgents: z.array(z.string()).default([]),
  denyMcp: z.array(z.string()).default([]),
  allowUserOverlay: z.boolean().default(true),
  userOverlayWhitelist: z.array(z.enum(["skills", "agents"])).default(["skills", "agents"]),
});

export const PutAssignmentsReqSchema = z.object({
  items: z.array(
    z.object({
      bundleId: UuidSchema,
      pin: z.string().min(1),
      ordering: z.number().int(),
    }),
  ),
});

export const EffectiveConfigSchema = z.object({
  hash: z.string(),
  manifest: ManifestSchema,
  sources: z.record(z.string()),
});

export const ApplyConfigReqSchema = z.object({
  workspaceIds: z.array(UuidSchema).optional(),
});

export const ApplyJobSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  kind: z.enum(["config", "common", "git_seed"]),
  targetHash: z.string(),
  trigger: z.enum(["workspace_ready", "manual", "publish", "rollback", "schedule"]),
  status: z.enum([
    "queued",
    "running",
    "succeeded",
    "partial",
    "failed",
    "skipped",
    "cancelled",
  ]),
  diffSummary: z
    .object({
      added: z.array(z.string()),
      removed: z.array(z.string()),
      changed: z.array(z.string()),
    })
    .optional(),
  error: z.string().optional(),
  startedAt: TimestampSchema.optional(),
  finishedAt: TimestampSchema.optional(),
});

export const ImportSkillReqSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]{1,48}$/),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      }),
    )
    .min(1),
});

export const ValidateBundleResSchema = z.object({
  ok: z.boolean(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});

export const SyncTaskResultReqSchema = z.object({
  status: z.enum(["succeeded", "failed"]),
  manifest: z.record(z.string()).optional(),
  error: z.string().optional(),
  added: z.array(z.string()).optional(),
  removed: z.array(z.string()).optional(),
  changed: z.array(z.string()).optional(),
});

export type SecretRef = z.infer<typeof SecretRefSchema>;
export type AgentDef = z.infer<typeof AgentDefSchema>;
export type McpDef = z.infer<typeof McpDefSchema>;
export type SkillRef = z.infer<typeof SkillRefSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type Bundle = z.infer<typeof BundleSchema>;
export type Revision = z.infer<typeof RevisionSchema>;
export type ConfigLock = z.infer<typeof ConfigLockSchema>;
export type EffectiveConfig = z.infer<typeof EffectiveConfigSchema>;
export type ApplyJob = z.infer<typeof ApplyJobSchema>;
export type ImportSkillReq = z.infer<typeof ImportSkillReqSchema>;
export type CreateBundleReq = z.infer<typeof CreateBundleReqSchema>;
export type PublishBundleReq = z.infer<typeof PublishBundleReqSchema>;
export type PutAssignmentsReq = z.infer<typeof PutAssignmentsReqSchema>;
export type ApplyConfigReq = z.infer<typeof ApplyConfigReqSchema>;
