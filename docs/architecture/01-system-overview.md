# 01 系统总览

## 1.1 目标与约束

- 双引擎（OpenCode / Claude Agent SDK）对等可调度，上层统一会话与事件抽象。
- 每个用户工作区 = 独立容器（或等价沙箱），文件系统与进程完全隔离。
- 一个 Project 多成员，会话归属用户，默认互不可见。
- 凭据可来自用户个人或项目共享，明文永不进浏览器。
- OpenCode 原生无多租户能力，多租户/授权/配置 SoT 全部由 Hub 补齐。

## 1.2 系统上下文（C4 Level 1）

```plantuml
@startuml context
!include <C4/C4_Context>
LAYOUT_WITH_LEGEND()

Person(dev, "项目成员", "developer / viewer")
Person(admin, "管理员", "tenant.admin / project.owner")
Person(ops, "运维", "部署远程 OpenCode / Node Agent")

System(hub, "AgentHubEx", "多租户 Agent 平台：控制面 + 门面 + 前端")

System_Ext(extoc, "远程 OpenCode serve", "他机部署，门户登记")
System_Ext(llm, "LLM Provider", "Anthropic / OpenAI / 兼容端点")
System_Ext(git, "Git 仓库", "工作区代码种子")
System_Ext(idp, "身份源 (可选)", "OIDC / SSO")
System_Ext(mcp, "远程 MCP 服务", "下发配置中引用")

Rel(dev, hub, "看板 / 开会话 / Workbench", "HTTPS")
Rel(admin, hub, "租户、实例、配置、凭据管理", "HTTPS")
Rel(ops, extoc, "部署")
Rel(hub, extoc, "反代会话 / 下发配置", "HTTPS 内网")
Rel(hub, llm, "LLM Proxy (Phase3)", "HTTPS")
Rel(extoc, llm, "推理调用", "HTTPS")
Rel(hub, idp, "登录 (可选)", "OIDC")
Rel(extoc, git, "clone")
Rel(extoc, mcp, "工具调用")
@enduml
```

## 1.3 容器视图（C4 Level 2）

```plantuml
@startuml containers
!include <C4/C4_Container>
LAYOUT_TOP_DOWN()

Person(user, "用户")

System_Boundary(hub, "AgentHubEx") {
  Container(shell, "Hub Shell SPA", "React + Vite + shadcn", "管理面 + Workbench 路由")
  Container(wb, "Workbench module", "packages/workbench", "会话/流式事件/文件树；只连 Facade")
  Container(api, "hub-api", "TypeScript + Hono", "Gateway/Facade + Control Plane + Apply 引擎")
  Container(worker_q, "hub-jobs", "BullMQ Worker (同 hub-api 代码)", "ApplyJob / SyncJob / 健康探测 / 回收")
  ContainerDb(pg, "PostgreSQL", "Drizzle", "元数据")
  ContainerDb(redis, "Redis", "", "会话缓存、限流、队列、SSE 扇出")
  ContainerDb(s3, "MinIO / S3", "", "公共空间、Bundle 物化产物")
}

System_Boundary(dp, "Data Plane") {
  Container(na, "node-agent", "TS + Dockerode", "managed 容器编排、卷写入")
  Container(woc, "worker-opencode", "容器", "managed OpenCode")
  Container(wcl, "worker-claude", "容器", "Claude Agent SDK")
  Container(sync, "agenthub-sync", "sidecar", "external 实例侧配置/文件落盘")
  Container_Ext(ext, "external opencode serve", "", "")
}

Rel(user, shell, "HTTPS")
Rel(user, wb, "HTTPS")
Rel(shell, api, "REST /v1", "JWT")
Rel(wb, api, "Facade SSE /v1/sessions/*；文件走 /v1/workspaces/{id}/agent/*", "JWT")
Rel(api, pg, "Drizzle ORM")
Rel(api, redis, "")
Rel(api, s3, "S3 API")
Rel(worker_q, pg, "")
Rel(worker_q, redis, "")
Rel(api, na, "mTLS 内网")
Rel(na, woc, "Docker API")
Rel(na, wcl, "Docker API")
Rel(api, woc, "反代 HTTP/SSE")
Rel(api, wcl, "反代 HTTP/SSE")
Rel(api, ext, "反代 HTTP/SSE (Basic Auth 代填)")
Rel(sync, api, "拉取任务/签名 URL", "长轮询/WS 出站")
Rel(sync, ext, "写 .opencode/** & reload")
@enduml
```

## 1.4 hub-api 内部组件（C4 Level 3）

```plantuml
@startuml components
!include <C4/C4_Component>

Container_Boundary(api, "hub-api") {
  Component(mw, "Middleware Chain", "Hono", "requestId / authn / tenant ctx / rbac / rate-limit / audit")
  Component(ctl, "Control API", "routes/v1/*", "租户、项目、成员、Issue、实例、Bundle、凭据、公共空间")
  Component(facade, "Session Facade", "routes/v1/sessions", "统一会话契约")
  Component(proxy, "Agent Reverse Proxy", "routes/v1/workspaces/:id/agent/*", "透传 OpenCode API，裁剪/阻断")
  Component(adapter, "Adapter Registry", "packages/adapter/*", "opencode / claude")
  Component(sched, "Scheduler", "", "选择节点/实例，懒创建工作区")
  Component(cred, "Credential Service", "", "解析、加解密、注入")
  Component(cfg, "Config Service", "packages/config-bundle", "合并、渲染、发布、Apply")
  Component(cfs, "CommonSpace Service", "packages/common-fs", "路径安全、版本、同步")
  Component(reg, "Instance Registry", "", "external 登记 / managed 回写 / 健康")
  Component(audit, "Audit & Metering", "", "审计日志、用量")
  Component(repo, "Repositories", "Drizzle ORM", "schema SoT；禁止裸 SQL；tenant_id 强过滤")
}

Rel(mw, ctl, "")
Rel(mw, facade, "")
Rel(mw, proxy, "")
Rel(facade, adapter, "")
Rel(facade, sched, "")
Rel(facade, cred, "")
Rel(proxy, reg, "解析 baseUrl/节点认证")
Rel(sched, reg, "")
Rel(cfg, adapter, "API 通道 Apply")
Rel(ctl, repo, "")
Rel(facade, repo, "")
Rel(cfs, repo, "")
Rel(audit, repo, "")
@enduml
```

## 1.5 分层职责

| 层 | 组件 | 职责 |
|---|---|---|
| 前端 | Hub Shell / Workbench | 管理 UI / 会话 IDE |
| 接入 | Gateway Middleware | 鉴权、租户上下文、限流、审计 |
| 门面 | Session Facade / Agent Proxy | 统一会话契约 + 原生 OpenCode API 反代 |
| 控制面 | Registry / Scheduler / Config / Credential / CommonSpace / Board | 元数据与编排 |
| 数据面 | node-agent / worker-* / external / agenthub-sync | 执行与落盘 |
| 存储 | PG / Redis / S3 | 元数据 / 缓存队列 / 对象 |

## 1.6 仓库结构与包依赖

```plantuml
@startuml packages
skinparam packageStyle rectangle
skinparam linetype ortho

package apps {
  [hub-shell]
  [hub-api]
  [node-agent]
  [agenthub-sync]
  package worker {
    [worker/common]
    [worker/opencode]
    [worker/claude]
  }
}

package packages {
  [domain]
  [auth]
  [runtime-contract]
  [config-bundle]
  [common-fs]
  [hub-ui-kit]
  [workbench]
  [agent-client]
  package adapter {
    [adapter/common]
    [adapter/opencode]
    [adapter/claude]
  }
  [db]
}

[hub-shell] --> [hub-ui-kit]
[hub-shell] --> [domain]
[hub-shell] --> [workbench]
[workbench] --> [agent-client]
[workbench] --> [hub-ui-kit]
[agent-client] --> [runtime-contract]

[hub-api] --> [domain]
[hub-api] --> [auth]
[hub-api] --> [db]
[hub-api] --> [config-bundle]
[hub-api] --> [common-fs]
[hub-api] --> [adapter/opencode]
[hub-api] --> [adapter/claude]

[adapter/opencode] --> [adapter/common]
[adapter/claude] --> [adapter/common]
[adapter/common] --> [runtime-contract]

[worker/opencode] --> [worker/common]
[worker/claude] --> [worker/common]
[worker/common] --> [runtime-contract]
[worker/common] --> [config-bundle] : Apply 钩子

[node-agent] --> [runtime-contract]
[node-agent] --> [common-fs]
[agenthub-sync] --> [config-bundle]
[agenthub-sync] --> [common-fs]
[db] --> [domain]
@enduml
```

**依赖规则**

- `domain` 不依赖任何运行时库（纯类型 + zod schema）。
- `apps/*` 之间不得互相 import，只能通过 HTTP 契约通信。
- 前端只通过 `agent-client` 访问工作区 agent API；不得直连节点 URL（见 [10](10-frontend.md)）。

```text
AgentHubEx/
  apps/{hub-shell,hub-api,node-agent,agenthub-sync,worker/{common,opencode,claude}}
  packages/{domain,auth,db,runtime-contract,config-bundle,common-fs,hub-ui-kit,workbench,agent-client,adapter/{common,opencode,claude}}
  deploy/{docker,compose}
  docs/architecture/
```

## 1.7 关键端到端流程（概览）

```plantuml
@startuml e2e
autonumber
actor 用户 as U
participant "Hub Shell" as S
participant "Workbench" as W
participant "hub-api" as H
participant "Scheduler" as SC
participant "Runtime" as R

U -> S : 登录，选择项目
S -> H : GET /v1/projects/{p}/board, /sessions
U -> S : 从 Issue 点「开会话」并选凭据
S -> H : POST /v1/projects/{p}/sessions {issueId, credentialId}
H -> H : 成员校验 + 凭据解析
H -> SC : 获取/创建个人 Workspace
SC --> H : RuntimeInstance(ready)
H -> R : 配置 Apply（若 revision 落后）
H -> R : 注入凭据 + 创建上游 session
H --> S : AgentSession{id, workspaceId, runtimeType}
S -> W : /p/{projectId}/workbench?session=...
W -> H : Facade SSE /v1/sessions/{id}/events
W -> H : 文件等走 /v1/workspaces/{w}/agent/file|find|...
H -> R : adapter / 白名单反代（代填节点认证）
R --> W : 归一事件与文件响应（经 Hub）
@enduml
```
