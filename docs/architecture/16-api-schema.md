# 16 API 字段级 Schema

> 单一来源：`packages/domain/src/api/*.ts`（zod）。`hub-api` 用 `@hono/zod-openapi` 生成 `/v1/openapi.json`；Hub Shell 直接 import 同一 schema 做表单校验。本文用 TypeScript 类型记法描述，`?` 表示可选。

## 16.1 通用约定（ADR-007）

| 项 | 约定 |
|---|---|
| 基础路径 | `/v1` |
| 编码 | JSON UTF-8；字段 camelCase；时间 ISO-8601 UTC（`2026-11-02T08:00:00.000Z`） |
| ID | UUIDv7 字符串；Issue 对外另有 `key`（`PROJ-12`），路径中 `{issueId}` 两者均可 |
| 鉴权 | `Authorization: Bearer <accessJwt | ahk_...>` |
| 幂等 | 见下方 **幂等矩阵**；键存 Redis 24h，值=首次响应摘要 |
| 并发控制 | 可变资源返回 `etag`（= `updatedAt` 哈希）；PATCH 可带 `If-Match` |
| 分页 | 游标：`?limit=50&cursor=<opaque>` → `{ items, nextCursor: string \| null }`；`limit` 1–200 |
| 排序 | `?sort=createdAt:desc`（每个列表声明允许字段） |
| 秘密字段 | 只出现在请求中（`secret`），任何响应都不会返回 |
| OpenAPI | CI：`pnpm openapi:gen` 产出 `openapi.json`；与 main 做 breaking-change diff 门禁；前端只 import `packages/domain` |
| 错误 | 见 16.15 |

### 幂等矩阵

| 端点 | Idempotency-Key | 重试安全 | 说明 |
|---|:-:|---|---|
| `POST .../sessions` | **必须** | 是 | 同键返回同一 session |
| `POST .../sessions/{id}/messages` | 建议 | 是 | 同键不重复入队上游 |
| `POST .../projects` / `POST .../issues` | **必须** | 是 | |
| `POST .../common/upload`（完成提交） | **必须** | 是 | 与 checksum 对齐 |
| `POST .../bundles/{b}/publish` | **必须** | 是 | 同键不产生双 revision |
| `POST .../config/apply` / `sync-config` / `sync-common` | **必须** | 是 | 同键返回同一 ApplyJob id |
| `POST .../workspaces/{w}/repos/{r}/seed` | **必须** | 是 | |
| `POST .../sessions/{id}/git/pull-request` | **必须** | 是 | 防重复 PR |
| `POST .../credentials` | **必须** | 是 | |
| `POST .../tenants/{t}/instances` | **必须** | 是 | |
| `POST .../archive` / `suspend` / `abort` | 建议 | 是 | 状态机幂等 |
| GET / PATCH（带 If-Match） | 否 | GET 是；PATCH 靠 etag | |

BullMQ 任务与 HTTP 幂等：业务写库 + `jobs_outbox` 同事务；消费者用 `jobId=outbox.id` 去重（见 [15.13.1](15-database-ddl.md)）。

```ts
type Uuid = string            // uuidv7
type Timestamp = string       // ISO-8601
type Page<T> = { items: T[]; nextCursor: string | null }
type ProjectRole = 'owner' | 'developer' | 'viewer'
type TenantRole = 'owner' | 'admin' | 'member'
type RuntimeType = 'opencode' | 'claude'
type CredentialSource = 'user' | 'project'
```

## 16.2 认证 `/v1/auth`

```ts
// POST /v1/auth/login
type LoginReq = { email: string /* email */; password: string /* 10..128 */ }
type LoginRes = { accessToken: string; expiresIn: number /* 秒 */; user: Me }
// Set-Cookie: ah_refresh=...; HttpOnly; Secure; SameSite=Strict; Path=/v1/auth

// POST /v1/auth/refresh          (cookie) → LoginRes
// POST /v1/auth/logout           → 204
// POST /v1/auth/switch-tenant    { tenantId: Uuid } → LoginRes

// POST /v1/auth/invitations/{token}/accept
type AcceptInvitationReq = { displayName: string /* 1..64 */; password?: string; handle: string /* ^[a-z0-9-]{2,32}$ */ }

// POST /v1/auth/password/forgot  { email } → 202
// POST /v1/auth/password/reset   { token, password } → 204

// GET  /v1/auth/methods?tenant=slug
type LoginMethodsRes = { password: boolean; oidc: { id: Uuid; name: string }[] }
// GET  /v1/auth/oidc/{providerId}/start → 302
// GET  /v1/auth/oidc/callback?code&state → 302

// GET /v1/me
type Me = {
  id: Uuid; email: string; displayName: string; handle: string
  isPlatformAdmin: boolean
  currentTenantId: Uuid | null
  tenants: { id: Uuid; slug: string; name: string; role: TenantRole; status: 'active' | 'suspended' }[]
}
```

## 16.3 租户、成员、邀请、API Key

```ts
type Tenant = {
  id: Uuid; slug: string; name: string; status: 'active' | 'suspended'
  quota: TenantQuota
  settings: { allowedLoginMethods: string[]; defaultModel?: string }
  createdAt: Timestamp
}
type TenantQuota = {
  maxConcurrentSessionsPerUser: number   // 默认 5
  maxActiveWorkspaces: number            // 默认 50（租户合计，含双引擎工作区）
  tokensPerDay?: number                  // 可选；未设=不限；超限见 04 §4.8.1
}
// GET   /v1/admin/tenants        (platform.admin) → Page<Tenant>
// POST  /v1/admin/tenants        (platform.admin) { slug, name, ownerEmail } → Tenant
// GET   /v1/tenants/{t}          → Tenant
// PATCH /v1/tenants/{t}          { name?, quota?, settings? } → Tenant
// POST  /v1/admin/tenants/{t}/suspend   { reason? } → Tenant   // status=suspended；级联见 03 §3.7
// POST  /v1/admin/tenants/{t}/unsuspend → Tenant

type TenantMember = { userId: Uuid; email: string; displayName: string; role: TenantRole; joinedAt: Timestamp }
// GET    /v1/tenants/{t}/members?q=&role= → Page<TenantMember>
// PATCH  /v1/tenants/{t}/members/{userId} { role } → TenantMember
// DELETE /v1/tenants/{t}/members/{userId} → 204
//   规则：不可移除最后一名 tenant.owner（409 CONFLICT）；级联清该用户在本租户全部 project_memberships + RevokeWorkspaceJob

type CreateInvitationReq = {
  email: string
  tenantRole: TenantRole
  projectGrants?: { projectId: Uuid; role: ProjectRole }[]
}
type Invitation = CreateInvitationReq & { id: Uuid; expiresAt: Timestamp; acceptedAt: Timestamp | null; inviteUrl?: string /* 仅创建时返回 */ }
// POST/GET /v1/tenants/{t}/invitations ; DELETE /v1/tenants/{t}/invitations/{id}

type ApiKey = { id: Uuid; name: string; prefix: string; scopes: string[]; actingUserId: Uuid | null; expiresAt: Timestamp | null; lastUsedAt: Timestamp | null }
type CreateApiKeyReq = { name: string; scopes: string[] /* permission 名 */; expiresInDays?: number /* 1..365 */; actingUserId?: Uuid }
type CreateApiKeyRes = ApiKey & { secret: string /* 仅此一次 */ }
// POST/GET /v1/tenants/{t}/api-keys ; DELETE /v1/tenants/{t}/api-keys/{id}
```

## 16.4 项目与成员

```ts
type Project = {
  id: Uuid; tenantId: Uuid; key: string /* ^[A-Z][A-Z0-9]{1,9}$ */; name: string; description?: string
  credentialPolicy: 'user_or_project' | 'project_only' | 'user_only'
  commonSyncPolicy: 'on_workspace_start' | 'on_common_publish'
  settings: ProjectSettings
  myRole: ProjectRole | null        // 当前用户角色
  archivedAt: Timestamp | null
  stats?: { todo: number; inProgress: number; inReview: number; done: number }
  createdAt: Timestamp; updatedAt: Timestamp; etag: string
}
type ProjectSettings = {
  strictConfig: boolean             // Apply 失败时拒绝开会话，默认 false
  promoteRequiresReview: boolean    // 默认 true
  allowSharedPush: boolean          // 默认 false
  workspaceSpec: { cpu: number; memMb: number; diskGb: number } // 默认 2/4096/20
  defaultRuntimeType: RuntimeType   // 默认 opencode
  issuePromptTemplate?: string
  /** 内网档建议配置：凭据 baseUrl 主机名须匹配（防误填公网）；空=不校验 */
  allowedProviderHosts?: string[]   // 如 ["llm.internal.example", "*.corp.local"]
}
// GET   /v1/tenants/{t}/projects?q=&archived= → Page<Project>
// POST  /v1/tenants/{t}/projects { key, name, description?, credentialPolicy?, settings? } → Project
// GET   /v1/projects/{p} → Project
// PATCH /v1/projects/{p} Partial<{name, description, credentialPolicy, commonSyncPolicy, settings}> → Project
// POST  /v1/projects/{p}/archive → Project     // 设 archivedAt；级联见 03 §3.7
// POST  /v1/projects/{p}/unarchive → Project   // 清 archivedAt；租户须为 active

type ProjectMember = { userId: Uuid; email: string; displayName: string; role: ProjectRole; workspaceStatus?: WorkspaceStatus }
// GET    /v1/projects/{p}/members → Page<ProjectMember>
// POST   /v1/projects/{p}/members { userId, role } → ProjectMember
// PATCH  /v1/projects/{p}/members/{userId} { role } → ProjectMember
// DELETE /v1/projects/{p}/members/{userId}?purgeWorkspace=false → 204
//   规则：不可移除最后一名 project.owner（409 CONFLICT）

// PUT /v1/me/projects/{p}/preferences
type MemberPrefs = { preferredCredential?: { source: CredentialSource; id: Uuid } | null; preferredRuntimeType?: RuntimeType }
```

## 16.5 Provider 凭据

```ts
type Provider = 'anthropic' | 'openai' | 'opencode' | 'custom'
type CredentialMeta = { baseUrl?: string /* https */; defaultModel?: string; orgId?: string }

type UserCredential = {
  id: Uuid; provider: Provider; label: string; metadata: CredentialMeta
  last4: string | null; status: 'active' | 'disabled' | 'expired'; version: number
  createdAt: Timestamp; updatedAt: Timestamp
}
type ProjectCredential = UserCredential & { allowedRoles: ProjectRole[]; isDefault: boolean }

type UpsertCredentialReq = {
  provider: Provider; label: string /* 1..64 */
  secret?: string        /* 新建必填；更新时提供即轮换 */
  metadata?: CredentialMeta
  status?: 'active' | 'disabled'
}
type UpsertProjectCredentialReq = UpsertCredentialReq & {
  allowedRoles?: ProjectRole[]; isDefault?: boolean
  rotationMode?: 'graceful' | 'immediate'   // 仅轮换时生效，默认 graceful
}
// GET/POST /v1/me/credentials ; PATCH/DELETE /v1/me/credentials/{id}
// GET/POST /v1/projects/{p}/credentials ; PATCH/DELETE /v1/projects/{p}/credentials/{id}
// POST /v1/me/credentials/{id}/test  → { ok: boolean; latencyMs?: number; error?: string }

// GET /v1/projects/{p}/credentials/options
type CredentialOptionsRes = {
  policy: Project['credentialPolicy']
  defaultChoice: { source: CredentialSource; id: Uuid } | null   // 按 06 解析规则
  options: { source: CredentialSource; id: Uuid; label: string; provider: Provider; isDefault: boolean }[]
}
```

## 16.6 运行时实例与节点

```ts
type InstanceHealth = 'pending' | 'healthy' | 'degraded' | 'unhealthy' | 'disabled'
type RuntimeInstance = {
  id: Uuid; name: string; mode: 'external' | 'managed'; runtimeType: RuntimeType
  baseUrl?: string                 // 仅 instance.manage 权限可见
  isolation: 'dedicated' | 'shared'
  labels: Record<string, string>
  health: InstanceHealth; latencyMs: number | null; upstreamVersion: string | null
  hasSyncAgent: boolean; syncAgentLastSeenAt: Timestamp | null
  maxSessions: number | null; assignedProjectIds: Uuid[]
  boundProjectCount: number; workspaceCount: number
  lastCheckedAt: Timestamp | null; createdAt: Timestamp
}
type RegisterInstanceReq = {
  name: string; runtimeType: 'opencode'          // external 首版仅 opencode
  baseUrl: string /* http(s)://host:port */; tlsVerify?: boolean
  auth?: { username: string; password: string }
  isolation?: 'dedicated' | 'shared'; labels?: Record<string, string>
  maxSessions?: number; assignedProjectIds?: Uuid[]; workdirHint?: string
  enableSyncAgent?: boolean
}
type RegisterInstanceRes = RuntimeInstance & { syncAgent?: { token: string; installCommand: string } /* 仅一次 */ }
// POST  /v1/tenants/{t}/instances/test  Omit<RegisterInstanceReq,'name'> → { ok; version?; latencyMs?; error? }
// POST  /v1/tenants/{t}/instances  → RegisterInstanceRes
// GET   /v1/tenants/{t}/instances?mode=&health=&label=k:v → Page<RuntimeInstance>
// PATCH /v1/instances/{id}  Partial<RegisterInstanceReq & {enabled: boolean}> → RuntimeInstance
// POST  /v1/instances/{id}/probe → RuntimeInstance
// POST  /v1/instances/{id}/sync-token/rotate → { token; installCommand }
// DELETE /v1/instances/{id} → 204 | 409 INSTANCE_IN_USE

type Binding = { id: Uuid; runtimeType: RuntimeType; instanceId?: Uuid; labelSelector?: Record<string, string>; priority: number }
// GET/PUT /v1/projects/{p}/bindings  { bindings: Omit<Binding,'id'>[] } → { bindings: Binding[] }

type Node = {
  id: Uuid; name: string; status: 'active' | 'draining' | 'offline' | 'disabled'
  labels: Record<string, string>
  capacity: { cpu: number; memMb: number; diskGb: number; maxWorkspaces: number }
  used: { cpu: number; memMb: number; diskGb: number; workspaces: number }
  agentVersion: string; lastHeartbeatAt: Timestamp | null
}
// GET  /v1/admin/nodes → Page<Node>          (platform.admin)
// POST /v1/admin/nodes/bootstrap-tokens { labels?, ttlMinutes? } → { token; expiresAt; installCommand }
// PATCH /v1/admin/nodes/{id} { status?: 'draining'|'active'|'disabled'; labels? } → Node
```

## 16.7 工作区

```ts
type WorkspaceStatus = 'provisioning' | 'seeding' | 'applying' | 'ready' | 'ready_degraded'
  | 'idle' | 'stopped' | 'unavailable' | 'revoked' | 'failed'
type Workspace = {
  id: Uuid; projectId: Uuid; ownerUserId: Uuid; runtimeType: RuntimeType
  status: WorkspaceStatus; statusReason: string | null
  mode: 'external' | 'managed'
  instance: { id: Uuid; name: string; health: InstanceHealth } | null
  config: { appliedHash: string | null; effectiveHash: string; upToDate: boolean; lastJob?: ApplyJob }
  common: { syncedAt: Timestamp | null; upToDate: boolean }
  repos: WorkspaceRepo[]
  /** status=ready|ready_degraded 时必填；其它状态可缺省 */
  capabilities?: Capabilities
  lastActiveAt: Timestamp | null; createdAt: Timestamp
}
/** 与 11.3 Capabilities 同形；嵌在 Workspace 上，无独立 GET */
type Capabilities = {
  v: 1
  files: boolean; find: boolean; lsp: boolean; pty: boolean
  mcpRuntimeAdd: boolean; permissions: boolean
  streaming: boolean; abort: boolean; usage: boolean
}

// GET  /v1/projects/{p}/workspaces/me?runtimeType=   → Workspace（不存在则懒创建，202 + status=provisioning）
// GET  /v1/workspaces/{w} → Workspace
// GET  /v1/workspaces/{w}/status/stream  (SSE: event=status data=Workspace)
// 注：进入 ready 时 Gateway 调 adapter.capabilities() 写入/缓存；缺探测则给引擎安全默认（opencode: 常见能力 true；claude: 按子集）
// POST /v1/workspaces/{w}/start | stop → Workspace
// POST /v1/workspaces/{w}/sync-config { force?: boolean } → ApplyJob
// POST /v1/workspaces/{w}/sync-common → ApplyJob
// GET  /v1/projects/{p}/workspaces  (owner：成员工作区状态列表，不含内容) → Page<Workspace>
```

## 16.8 会话

```ts
type SessionStatus = 'creating' | 'active' | 'busy' | 'idle' | 'aborted' | 'archived' | 'failed'
type AgentSession = {
  id: Uuid; projectId: Uuid; workspaceId: Uuid; ownerUserId: Uuid
  title: string; runtimeType: RuntimeType; status: SessionStatus; statusReason: string | null
  credential: { source: CredentialSource; id: Uuid; label: string; version: number }
  model: string | null; agent: string | null
  issue: { id: Uuid; key: string; title: string; status: IssueStatus } | null
  branch: { repoId: Uuid; branch: string; baseBranch: string; prUrl: string | null } | null
  usage: { inputTokens: number; outputTokens: number }
  lastMessageAt: Timestamp | null; createdAt: Timestamp
}
type CreateSessionReq = {
  title?: string /* 1..200，默认「新会话」或 Issue key+标题 */
  runtimeType?: RuntimeType
  credentialSource?: CredentialSource; credentialId?: Uuid   // 需同时提供
  issueId?: Uuid | string
  createBranch?: boolean                                    // 默认 issueId 存在时 true
  model?: string; agent?: string
  initialPrompt?: string /* <= 32k */
}
// GET    /v1/projects/{p}/sessions?status=&issueId=&q= → Page<AgentSession>   (仅自己的)
// POST   /v1/projects/{p}/sessions → 201 AgentSession
// GET    /v1/sessions/{id} → AgentSession
// PATCH  /v1/sessions/{id} { title? } → AgentSession
// DELETE /v1/sessions/{id} → 204 (归档)
// POST   /v1/sessions/{id}/abort → 202

type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'file'; path: string }                 // 工作区内相对路径
  | { type: 'image'; mime: 'image/png' | 'image/jpeg' | 'image/webp'; dataBase64: string /* <=5MB */ }
type SendMessageReq = { parts: MessagePart[] /* 1..20 */; model?: string; agent?: string }
// POST /v1/sessions/{id}/messages → 202 { messageId: string }

type Message = {
  id: string; role: 'user' | 'assistant'
  parts: (MessagePart | { type: 'tool'; toolId: string; name: string; input: unknown; output?: unknown; isError?: boolean })[]
  model?: string; usage?: { inputTokens: number; outputTokens: number }
  createdAt: Timestamp; completedAt?: Timestamp
}
// GET /v1/sessions/{id}/messages?cursor=&limit= → Page<Message>

// POST /v1/sessions/{id}/permissions/{reqId}
type PermissionDecisionReq = { decision: 'allow' | 'deny' | 'always'; updatedInput?: unknown }

// GET  /v1/sessions/{id}/events   SSE，data 为 11.3 的 Envelope
// 鉴权：Authorization Bearer（fetch-event-source）或 ?ticket=
// POST /v1/sessions/{id}/events/ticket → { ticket: string, expiresIn: 60 }  // 单次、绑定 session+user

// GET /v1/admin/projects/{p}/sessions → Page<Omit<AgentSession,'branch'>>   (只元数据)
```

## 16.9 配置中心

```ts
type AgentDef = {
  name: string /* ^[a-z0-9-]{1,48}$ */; description: string
  mode?: 'primary' | 'subagent' | 'all'; model?: string
  prompt: string                          // markdown body
  tools?: Record<string, boolean>; permission?: PermissionMatrix
}
type SecretRef = { $secret: { kind: 'projectCredential' | 'vault'; id: string; field?: string } }
type McpDef = {
  name: string /* ^[a-z0-9_-]{1,48}$ */
  transport: 'local' | 'remote'
  command?: string[]                      // local 必填
  url?: string                            // remote 必填
  headers?: Record<string, string | SecretRef>
  env?: Record<string, string | SecretRef>
  enabled: boolean; roles?: ProjectRole[]; timeoutMs?: number
}
type SkillRef = { name: string; files: { path: string; sha256: string; size: number }[] } // 必含 SKILL.md
type PermissionMatrix = { edit?: Rule; bash?: Rule | Record<string, Rule>; webfetch?: Rule; [k: string]: unknown }
type Rule = 'allow' | 'ask' | 'deny'
type Manifest = {
  agents: AgentDef[]; mcp: McpDef[]; skills: SkillRef[]
  instructions: { agentsMd?: string; extra?: string[] }
  permission?: PermissionMatrix; model?: string
  includeCommonAgentsMd?: boolean
}
type Bundle = {
  id: Uuid
  scope: 'platform' | 'tenant' | 'project' | 'user'
  scopeId: Uuid | null   // platform 时为 null
  name: string; draft: Manifest; latestVersion: number | null; updatedAt: Timestamp; etag: string
}
type Revision = { id: Uuid; bundleId: Uuid; version: number; state: 'published' | 'archived'; contentHash: string; changelog?: string; publishedBy: Uuid; publishedAt: Timestamp }

// GET/POST /v1/projects/{p}/bundles, /v1/tenants/{t}/bundles  { name } → Bundle
// PUT  /v1/bundles/{b}/draft  (If-Match) Manifest → Bundle
// POST /v1/bundles/{b}/blobs  multipart file → { sha256; size }
// POST /v1/bundles/{b}/skills/import  multipart zip → SkillRef
// POST /v1/bundles/{b}/validate → { ok: boolean; errors: { path: string; message: string }[] }
// POST /v1/bundles/{b}/publish { changelog? } → Revision
// GET  /v1/bundles/{b}/revisions → Page<Revision>
// GET  /v1/bundles/{b}/revisions/{r}/diff?against= → { added; removed; changed }
// POST /v1/bundles/{b}/rollback { revisionId } → Revision

type ConfigLock = { lockMcp: boolean; forcedAgents: string[]; denyMcp: string[]; allowUserOverlay: boolean; userOverlayWhitelist: ('skills' | 'agents')[] }
// PUT /v1/projects/{p}/config/assignments { items: { bundleId; pin: 'latest' | Uuid; ordering }[] }
// PUT /v1/projects/{p}/config/lock ConfigLock
// GET /v1/projects/{p}/config/effective?userId= → { hash; manifest: Manifest /* secret 显示为 SecretRef */; sources: Record<string, string> }
// POST /v1/projects/{p}/config/apply { workspaceIds?: Uuid[] } → { jobs: ApplyJob[] }

type ApplyJob = {
  id: Uuid; workspaceId: Uuid; kind: 'config' | 'common' | 'git_seed'; targetHash: string
  trigger: 'workspace_ready' | 'manual' | 'publish' | 'rollback' | 'schedule'
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped' | 'cancelled'
  diffSummary?: { added: string[]; removed: string[]; changed: string[] }
  error?: string; startedAt?: Timestamp; finishedAt?: Timestamp
}
// GET /v1/projects/{p}/apply-jobs?workspaceId=&status= → Page<ApplyJob>
```

## 16.10 公共空间

```ts
type CommonEntry = {
  path: string; name: string; isDir: boolean; size: number; mime?: string
  checksum?: string; version: number; protected: boolean
  updatedBy: { id: Uuid; displayName: string }; updatedAt: Timestamp
}
// GET    /v1/projects/{p}/common/tree?prefix=&depth=1 → { entries: CommonEntry[] }
// GET    /v1/projects/{p}/common/files/{path}?version=&download=1  → 原始内容 (ETag: checksum)
// PUT    /v1/projects/{p}/common/files/{path}  body=原始内容, Content-Type, If-Match? → CommonEntry
// POST   /v1/projects/{p}/common/dirs { path } → CommonEntry
// PATCH  /v1/projects/{p}/common/files/{path} { moveTo: string } → CommonEntry
// DELETE /v1/projects/{p}/common/files/{path}?recursive= → 204
// POST   /v1/projects/{p}/common/upload  multipart: files[], prefix → { entries: CommonEntry[] }
// POST   /v1/projects/{p}/common/upload-url { path, size, mime } → { url; headers; expiresAt; finalizeToken }
// POST   /v1/projects/{p}/common/upload-finalize { finalizeToken } → CommonEntry
// POST   /v1/projects/{p}/common/upload-zip multipart: file, prefix → { created: number; skipped: { path; reason }[] }
// GET    /v1/projects/{p}/common/files/{path}/versions → { versions: { version; size; checksum; createdBy; createdAt }[] }
// POST   /v1/projects/{p}/common/files/{path}/restore { version } → CommonEntry
// GET    /v1/projects/{p}/common/trash → Page<CommonEntry & { deletedAt }> ; POST .../trash/restore { path }
// GET    /v1/projects/{p}/common/search?q= → Page<CommonEntry>
// GET/PUT /v1/projects/{p}/common/settings { quotaBytes; protectedPrefixes: string[]; syncPolicy } (+ usedBytes 只读)
// POST   /v1/projects/{p}/common/promote { workspaceId; items: { srcPath; destPath }[] } → 201 CommonEntry[] | 202 { changeRequestId }
// POST   /v1/projects/{p}/common/change-requests/{id}/approve|reject → 204
```

## 16.11 看板与 Issue

```ts
type IssueStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled'
type Issue = {
  id: Uuid; key: string; projectId: Uuid
  title: string /* 1..200 */; description: string /* markdown, <=64k */
  priority: 'P0' | 'P1' | 'P2' | 'P3'; status: IssueStatus
  assignee: { id: Uuid; displayName: string } | null
  labels: string[] /* 每个 1..32, 最多 20 */
  rank: string; resolutionNote: string | null
  linkedSessions: { id: Uuid; title: string; ownerUserId: Uuid; ownerName: string; status: SessionStatus; canOpen: boolean }[]
  pendingProposal: { id: Uuid; toStatus: 'in_review' | 'done'; summary: string | null; sessionId: Uuid | null } | null
  prs: { url: string; state: 'open' | 'merged' | 'closed' }[]
  createdBy: Uuid; createdAt: Timestamp; updatedAt: Timestamp; etag: string
}
type CreateIssueReq = Pick<Issue, 'title'> & Partial<Pick<Issue, 'description' | 'priority' | 'labels'>> & { assigneeUserId?: Uuid; status?: 'todo' | 'in_progress' }
type UpdateIssueReq = Partial<{
  title: string; description: string; priority: Issue['priority']; labels: string[]
  assigneeUserId: Uuid | null; status: IssueStatus; resolutionNote: string
  position: { beforeId?: Uuid; afterId?: Uuid }    // 拖拽：目标列中的前后卡片
}>
// GET    /v1/projects/{p}/board?includeCancelled=false → { columns: { status: IssueStatus; total: number; items: Issue[]; nextCursor: string | null }[] }
// GET    /v1/projects/{p}/board/events  SSE:
//   event=issue.upserted data=Issue
//   event=issue.deleted  data={ id }
//   event=board.resync   data={ reason: string }  // 客户端整板重拉 GET .../board
// GET    /v1/projects/{p}/board/stats?range=week → { counts: Record<IssueStatus, number>; createdThisRange: number; closedThisRange: number }
// GET    /v1/projects/{p}/issues?status=&assignee=me|<id>&label=&priority=&q=&sort= → Page<Issue>
// POST   /v1/projects/{p}/issues → 201 Issue
// GET    /v1/issues/{idOrKey} → Issue
// PATCH  /v1/issues/{idOrKey}  (If-Match) → Issue | 409 ISSUE_CONFLICT | 422 INVALID_TRANSITION
// DELETE /v1/issues/{idOrKey} → 204 (软删, owner)
// POST   /v1/issues/{id}/links { sessionId } → 204 ; DELETE /v1/issues/{id}/links/{sessionId} → 204
// POST   /v1/issues/{id}/comments { body } → IssueEvent
// GET    /v1/issues/{id}/timeline → Page<IssueEvent>
// POST   /v1/issues/{id}/proposals { sessionId?, toStatus, summary? } → Proposal
// POST   /v1/issues/{id}/proposals/{pid}/accept | reject → Issue
type IssueEvent = { id: Uuid; type: string; from?: string; to?: string; payload: Record<string, unknown>; actor: { id: Uuid; displayName: string } | null; createdAt: Timestamp }
```

## 16.12 Git

```ts
type ProjectRepo = {
  id: Uuid; provider: 'github' | 'gitlab' | 'gitea' | 'generic'
  cloneUrl: string /* https:// */; fullName?: string; defaultBranch: string
  slug: string; isPrimary: boolean; seedPolicy: 'on_create' | 'manual'
  shallowDepth?: number; branchPrefix: string; commitTrailer: boolean
}
// GET/POST /v1/projects/{p}/repos ; PATCH/DELETE /v1/projects/{p}/repos/{repoId}
// POST /v1/projects/{p}/repos/test { cloneUrl, credentialId? } → { ok; defaultBranch?; error? }

type GitCredential = {
  id: Uuid; provider: ProjectRepo['provider']; host: string
  authType: 'pat' | 'deploy_key' | 'app_installation'; username?: string
  scopes: ('read' | 'write' | 'api')[]; label: string; last4: string | null
  status: 'active' | 'disabled' | 'expired'; expiresAt: Timestamp | null
}
type UpsertGitCredentialReq = Omit<GitCredential, 'id' | 'last4' | 'status'> & { secret?: string }
// GET/POST /v1/me/git-credentials ; PATCH/DELETE /v1/me/git-credentials/{id}
// GET/POST /v1/projects/{p}/git-credentials ; PATCH/DELETE ...

type WorkspaceRepo = { repoId: Uuid; slug: string; path: string; status: 'pending' | 'cloning' | 'ready' | 'failed'; error?: string; headBranch?: string; headSha?: string; dirty: boolean; ahead: number; lastFetchedAt?: Timestamp }
// GET  /v1/workspaces/{w}/repos → { items: WorkspaceRepo[] }
// POST /v1/workspaces/{w}/repos/{repoId}/seed → ApplyJob
// POST /v1/workspaces/{w}/repos/{repoId}/fetch → WorkspaceRepo

// POST /v1/sessions/{id}/git/pull-request
type CreatePrReq = { repoId?: Uuid /* 默认主仓库 */; title?: string; body?: string; draft?: boolean /* 默认 true */; base?: string }
type CreatePrRes = { url: string; number: number; branch: string; pushed: boolean }
```

## 16.13 内部接口（不对浏览器开放）

| 调用方 | 路径 | 认证 | 载荷 |
|---|---|---|---|
| node-agent | `POST /v1/nodes/register` | bootstrap token | 见下方 Node 协议 |
| node-agent | `POST /v1/nodes/heartbeat` | mTLS | 见下方 |
| node-agent | `POST /v1/nodes/cert/renew` | mTLS | `{csr}` → `{cert, notAfter}` |
| agenthub-sync | `GET /v1/sync/tasks?wait=30` | sync token | → `{tasks:[{id, type:'apply'|'common'|'git_seed', manifest, urls, signature}]}` |
| agenthub-sync | `POST /v1/sync/tasks/{id}/result` | sync token | `{status, manifest?, error?}` |
| worker | `POST /v1/internal/workspaces/{w}/git-credential` | 实例 token | `{host, path, op}` → `{username, password, expiresAt}` |
| Git 平台 | `POST /v1/webhooks/git/{provider}` | HMAC | 平台原始 payload |

### Node Agent 协议字段（摘要；细节见 [05 §5.9](05-runtime-instances.md)）

```ts
type NodeRegisterReq = {
  token: string
  csr: string                    // PEM
  capacity: { cpu: number; memMb: number; diskGb: number; maxWorkspaces: number }
  labels: Record<string, string>
  agentVersion: string           // semver；与 Hub 协商 minAgentVersion
  hostname?: string
}
type NodeRegisterRes = { nodeId: Uuid; cert: string; caBundle: string; notAfter: Timestamp }

type NodeHeartbeatReq = {
  used: { cpu: number; memMb: number; diskGb: number; workspaces: number }
  workspaces: { id: Uuid; state: 'running' | 'stopped' | 'missing'; containerId?: string }[]
  agentVersion: string
  wallTime: Timestamp            // 时钟漂移 > 60s → Hub 记 warning，不拒心跳
}
type NodeCommand =
  | { type: 'create_workspace'; workspaceId: Uuid; spec: unknown }
  | { type: 'start_workspace' | 'stop_workspace' | 'delete_workspace'; workspaceId: Uuid; purgeVolume?: boolean }
  | { type: 'drain' }            // 拒新调度；完成现有后可 offline
  | { type: 'renew_cert_hint' }
type NodeHeartbeatRes = { commands: NodeCommand[]; minAgentVersion?: string }
```

## 16.13.1 审计查询 / 导出

```ts
// GET /v1/tenants/{t}/audit?actor=&action=&from=&to=&cursor=
type AuditEntry = {
  id: Uuid; at: Timestamp; actorId: Uuid | null; actorType: string
  action: string; targetType: string; targetId: string | null
  meta: Record<string, unknown>; ip?: string
}
// GET /v1/tenants/{t}/audit/export?from=&to=&format=ndjson  → 202 { jobId } | 200 stream
// 保留期默认 365 天（租户 settings.auditRetentionDays）；platform.admin 可查跨租户 /v1/admin/audit
```

## 16.13.2 用量只读（不计费）

```ts
// GET /v1/tenants/{t}/usage?from=&to=&groupBy=project|user|day
// GET /v1/projects/{p}/usage?from=&to=
type UsageBucket = { key: string; inputTokens: number; outputTokens: number; costMicros?: number }
```

## 16.14 示例

```http
POST /v1/projects/0193.../sessions
Authorization: Bearer eyJ...
Idempotency-Key: 8c1f...
Content-Type: application/json

{ "issueId": "PROJ-12", "credentialSource": "project", "credentialId": "0193...c2",
  "initialPrompt": "请先阅读 project-common/docs/spec.md 再修复该问题" }
```

```json
HTTP/1.1 201 Created
{
  "id": "0193a1b2-...",
  "projectId": "0193...",
  "workspaceId": "0193...",
  "title": "PROJ-12 登录页在 Safari 下白屏",
  "runtimeType": "opencode",
  "status": "busy",
  "credential": { "source": "project", "id": "0193...c2", "label": "公司 Claude", "version": 3 },
  "issue": { "id": "0193...", "key": "PROJ-12", "title": "登录页在 Safari 下白屏", "status": "in_progress" },
  "branch": { "repoId": "0193...", "branch": "agenthub/jack/PROJ-12-safari-blank", "baseBranch": "main", "prUrl": null },
  "usage": { "inputTokens": 0, "outputTokens": 0 },
  "createdAt": "2026-11-02T08:00:00.000Z"
}
```

## 16.15 错误信封与完整错误码

```ts
type ErrorRes = { error: { code: string; message: string; requestId: string; details?: Record<string, unknown>; fieldErrors?: { path: string; message: string }[] } }
```

| HTTP | code | 说明 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 带 `fieldErrors` |
| 400 | `INVALID_PATH` | 公共空间/同步路径非法 |
| 401 | `UNAUTHENTICATED` / `TOKEN_EXPIRED` | |
| 403 | `FORBIDDEN` / `BLOCKED_UPSTREAM_PATH` / `PROTECTED_PATH` / `LOGIN_METHOD_DISABLED` | |
| 404 | `NOT_FOUND` | 含无权访问 |
| 409 | `CONFLICT` / `ISSUE_CONFLICT` / `ETAG_MISMATCH` | 并发 |
| 409 | `CREDENTIAL_REQUIRED` / `CREDENTIAL_POLICY_VIOLATION` / `CREDENTIAL_ROTATED` | |
| 409 | `GIT_CREDENTIAL_REQUIRED` / `GIT_PUSH_REJECTED` / `NOTHING_TO_PUSH` | |
| 409 | `WORKSPACE_NOT_READY`（`details.retryAfter`）/ `CONFIG_APPLY_FAILED` / `INSTANCE_IN_USE` | |
| 412 | `PRECONDITION_FAILED` | If-Match 不匹配 |
| 413 | `PAYLOAD_TOO_LARGE` | |
| 422 | `INVALID_TRANSITION` | Issue 状态迁移非法 |
| 423 | `ACCOUNT_LOCKED` | 登录失败锁定 |
| 429 | `RATE_LIMITED` / `QUOTA_EXCEEDED`（`details.quota`） | 带 `Retry-After` |
| 409 | `TENANT_SUSPENDED` / `PROJECT_ARCHIVED` | 生命周期门禁 |
| 409 | `SSE_CURSOR_STALE` | 亦可经 SSE `error` 事件投递（见 04 §4.4.1） |
| 501 | `NOT_SUPPORTED_BY_RUNTIME` | Claude worker 缺能力 |
| 502 | `UPSTREAM_UNAVAILABLE` | |
| 504 | `UPSTREAM_TIMEOUT` | |
