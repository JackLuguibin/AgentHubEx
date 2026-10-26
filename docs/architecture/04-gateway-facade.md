# 04 Gateway / Facade

对外只暴露 Hub API。节点 Basic Auth、baseUrl、Provider Key 永不出现在响应中。

## 4.1 中间件链

```plantuml
@startuml middleware
skinparam defaultTextAlignment center
rectangle "requestId\n+ OTel span" as m1
rectangle "CORS / 安全头" as m2
rectangle "authn\nJWT | ApiKey" as m3
rectangle "tenantContext\n(ctx.tenantId)" as m4
rectangle "rateLimit\n(user+tenant, Redis 令牌桶)" as m5
rectangle "authz\n(perm + owner)" as m6
rectangle "audit\n(写操作)" as m7
rectangle "handler" as h
rectangle "errorMapper\n(统一错误信封)" as e
m1 -> m2
m2 -> m3
m3 -> m4
m4 -> m5
m5 -> m6
m6 -> m7
m7 -> h
h -[dashed]-> e
@enduml
```

## 4.2 两类客户端通道（已收紧）

| 通道 | 路径 | 使用方 | 说明 |
|---|---|---|---|
| **A. 统一会话 Facade** | `/v1/projects/{p}/sessions`、`/v1/sessions/{id}/*` | **Workbench 聊天主路径**、Shell、SDK、看板 | 引擎无关；消息/权限/SSE 只走这里 |
| **B. 原生 Agent 反代** | `/v1/workspaces/{w}/agent/*` | Workbench **文件树 / find / PTY** | 白名单透传；**不**承载会话创建与事件流 |

`agent-client` 约定：会话 API → A；`files`/`find`/`pty`（及只读 `agent`/`mcp`/`config`）→ B。浏览器不得打开 `/agent/event` 或经 B `POST /session`。

## 4.3 反代请求处理

```plantuml
@startuml proxy
autonumber
participant Workbench as W
participant "Gateway\n/v1/workspaces/{w}/agent/*" as G
database "Redis\n(route cache)" as RC
database PG
participant "Runtime\n(baseUrl)" as R

W -> G : GET /v1/workspaces/w1/agent/file?path=...\nAuthorization: Bearer JWT
G -> G : authn + authz(workspace.own)
G -> RC : route:w1
alt miss
  G -> PG : workspace → instance(baseUrl, authSecret)
  G -> RC : 缓存 60s（不缓存明文，仅 instanceId）
end
G -> G : 路径白名单匹配
alt 命中阻断表
  G --> W : 403 BLOCKED_UPSTREAM_PATH
else 放行
  G -> G : 剥离客户端 Authorization/Cookie\n注入 Basic Auth (解密于内存)
  G -> R : 转发 (timeout, 体积上限)
  R --> G : 响应
  G -> G : 响应裁剪（去除 baseUrl 等泄露字段）
  G --> W : 响应
end
@enduml
```

### 路径策略表（浏览器 → `/agent/*` → OpenCode 上游）

| 上游路径 | 方法 | 策略 |
|---|---|---|
| `/file/**`, `/find/**` | GET | **放行**（工作区内） |
| `/agent`, `/mcp` | GET | **放行**（只读发现） |
| `/config` | GET | **放行**（响应脱敏 secret） |
| `/pty/**` | WS | **放行**（P2+；受 `capabilities.pty` 与租户开关） |
| `/session`, `/session/:id/**` | * | **阻断**（会话一律 Facade；adapter 内网直连上游） |
| `/event` | GET | **阻断**（会话 SSE 仅 `/v1/sessions/{id}/events`；Gateway 内网拉上游 `/event`） |
| `/mcp` | POST | **阻断**（仅 Apply 引擎内部） |
| `/config` | PATCH | **阻断** |
| `/auth/**` | * | **阻断**，由 Hub 代写 |
| `/global/**`、`/project` 切换类 | * | **阻断** |
| 其它未知 | * | 默认**阻断**，日志告警 |

会话创建只走 `POST /v1/projects/{p}/sessions`（见 4.6）：Facade → adapter 内网 `createSession` → 上游，再写入 `agent_sessions.runtime_session_ref`。

## 4.4 SSE 代理

```plantuml
@startuml sse
autonumber
participant Client as C
participant Gateway as G
database Redis
participant Runtime as R

C -> G : GET /v1/sessions/{id}/events\nLast-Event-ID: 1042
G -> G : authz(session.own)
G -> Redis : INCR sse:user:{u} (并发上限检查)
G -> R : 打开上游 SSE (/event 或 worker /events)
loop 每条上游事件
  R -> G : event
  G -> G : adapter.normalize → Envelope
  G -> G : 过滤非本 session 事件\n(OpenCode /event 为实例级)
  G -> Redis : XADD sess:{id}:events (MAXLEN 2000)
  G -> C : id: seq\nevent: type\ndata: Envelope
end
G -> C : 每 15s ": ping"
C -> G : 断开
G -> Redis : DECR sse:user:{u}
note over G,R
上游连接按 workspace 复用：
同一 workspace 多个客户端共享一条上游 /event，
Gateway 内部扇出。断开不销毁容器（idle TTL 管理）。
重连时从 Redis Stream 补发 Last-Event-ID 之后事件。
end note
@enduml
```

## 4.5 统一会话 API 清单

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/v1/projects/{p}/sessions` | session.own | 仅当前用户；`?issueId=&status=` |
| POST | `/v1/projects/{p}/sessions` | session.create | `{title?, runtimeType?, credentialSource?, credentialId?, issueId?}` |
| GET | `/v1/sessions/{id}` | session.own | 元数据 |
| POST | `/v1/sessions/{id}/messages` | session.own | `{parts:[{type:'text',text}], model?, agent?}` |
| POST | `/v1/sessions/{id}/abort` | session.own | |
| POST | `/v1/sessions/{id}/permissions/{reqId}` | session.own | `{decision: allow|deny|always}` |
| GET | `/v1/sessions/{id}/events` | session.own | SSE（Bearer 或 ticket） |
| POST | `/v1/sessions/{id}/events/ticket` | session.own | `{ ticket: string, expiresIn: 60 }`；单次、绑定 session+user |
| GET | `/v1/sessions/{id}/messages` | session.own | 历史，分页 |
| DELETE | `/v1/sessions/{id}` | session.own | 归档 |
| GET | `/v1/projects/{p}/credentials/options` | session.create | 可选凭据（元数据） |
| GET | `/v1/projects/{p}/workspaces/me` | workspace.own | 懒创建 |
| POST | `/v1/workspaces/{w}/start` / `stop` | workspace.own | managed |
| POST | `/v1/workspaces/{w}/sync-config` | workspace.own | 触发 Apply |
| POST | `/v1/workspaces/{w}/sync-common` | workspace.own | 同步公共空间 |
| GET | `/v1/admin/projects/{p}/sessions` | session.audit_meta | 元数据审计 |

控制面 API（项目/成员/实例/Bundle/公共空间/Issue）见各模块文档。

## 4.6 创建会话时序

```plantuml
@startuml session-create
autonumber
actor U
participant Facade as F
participant "CredentialSvc" as C
participant "Scheduler" as S
participant "ConfigSvc" as CF
participant "Adapter" as A
participant Runtime as R
database PG

U -> F : POST /v1/projects/p1/sessions {credentialId?, issueId?}
F -> F : authz(session.create)
F -> PG : 配额检查 (用户并发会话 / 租户日 token)
F -> C : resolve(user, project, request)
C --> F : CredentialRef{source, id, version}
F -> S : ensureWorkspace(p1, user)
S --> F : workspace + instance(ready)
F -> CF : ensureApplied(workspace)
alt revision 落后
  CF -> R : Apply (见 07)
  alt Apply 失败 且 project.strictConfig
    F --> U : 409 CONFIG_APPLY_FAILED
  end
end
F -> C : inject(instance, credRef)
C -> R : PUT /auth/{provider} (内网)
F -> A : createSession(instance, {title})
A -> R : POST /session
R --> A : {id: up_123}
F -> PG : INSERT agent_sessions(runtime_session_ref=up_123, credential_*, issue_id)
opt issueId
  F -> PG : INSERT issue_session_links；issue todo→in_progress
end
F --> U : 201 AgentSession
@enduml
```

## 4.7 错误信封与错误码

```json
{ "error": { "code": "CREDENTIAL_REQUIRED", "message": "...", "requestId": "01J...", "details": {} } }
```

| HTTP | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | zod 校验失败 |
| 401 | `UNAUTHENTICATED` | |
| 403 | `FORBIDDEN` / `BLOCKED_UPSTREAM_PATH` | |
| 404 | `NOT_FOUND` | 包括无权访问 |
| 409 | `CREDENTIAL_REQUIRED` | 无可用凭据 |
| 409 | `CREDENTIAL_POLICY_VIOLATION` | 策略不允许该来源 |
| 409 | `CREDENTIAL_ROTATED` | 旧版本已失效，需重选 |
| 409 | `CONFIG_APPLY_FAILED` | |
| 409 | `WORKSPACE_NOT_READY` | 含 `retryAfter` |
| 429 | `RATE_LIMITED` / `QUOTA_EXCEEDED` | |
| 502 | `UPSTREAM_UNAVAILABLE` | 实例不健康 |
| 504 | `UPSTREAM_TIMEOUT` | |

## 4.8 限流与配额

| 维度 | 默认 | 实现 |
|---|---|---|
| API QPS / 用户 | 20 r/s 突发 40 | Redis 令牌桶 |
| SSE 并发 / 用户 | 10 | Redis 计数 |
| 并发活跃会话 / 用户 | 5 | PG count + Redis 缓存 |
| 活跃工作区 / 项目 | 50 | PG |
| Token / 租户 / 日 | 租户配额 | UsageRecord 聚合（Phase 3 LLM Proxy 精确拦截） |
