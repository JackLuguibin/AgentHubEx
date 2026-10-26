# 03 认证与 RBAC

## 3.1 身份类型

| 主体 | 凭证 | 用途 |
|---|---|---|
| 人类用户 | Hub JWT（access 15 min + refresh 7 d，refresh 存 httpOnly cookie） | Hub Shell / Workbench |
| 开放 API | `HubApiKey`（`ahk_<prefix>_<secret>`，库中存 argon2 hash） | SDK / CLI / CI |
| Node Agent | mTLS 客户端证书（bootstrap token 换发） | 心跳、任务回执 |
| agenthub-sync | 实例级 sync token（绑定 instanceId，可吊销） | 拉取 Apply/Sync 任务 |
| 内部 Job | 服务账号上下文（不出进程） | 队列任务 |

## 3.2 登录与令牌刷新

```plantuml
@startuml login
autonumber
actor U
participant "Hub Shell" as S
participant "hub-api /auth" as A
database PG
database Redis

U -> S : 邮箱 + 密码 (或 OIDC)
S -> A : POST /v1/auth/login
A -> PG : 查 user, 校验 argon2
A -> PG : 查 tenant_memberships
A -> Redis : 记录 refresh family (jti)
A --> S : access JWT (body) + refresh (httpOnly cookie)
note right of S
access JWT claims:
sub, tid(当前租户), troles,
pa(platform admin), jti, exp
（项目角色不进 JWT，按请求查缓存）
end note
...access 过期...
S -> A : POST /v1/auth/refresh (cookie)
A -> Redis : 校验 family 未吊销，旋转 refresh
A --> S : 新 access + 新 refresh
alt refresh 重放
  A -> Redis : 吊销整个 family
  A --> S : 401 → 重新登录
end
@enduml
```

### 3.2.1 本地账号（首版）与 OIDC（预留）——ADR-001

| 项 | 方案 |
|---|---|
| 注册 | 不开放自助注册；租户 admin 发邀请链接（token 72h，单次），被邀请人设密码后加入租户 |
| 密码 | argon2id（m=64MB, t=3, p=1）；最少 10 位；连续 5 次失败锁 15 分钟（Redis 计数，按 email+IP） |
| 找回 | 邮件重置链接（token 30 min，单次）；未配置 SMTP 时由 admin 重置 |
| 平台初始化 | 首次启动读 `AGENTHUB_BOOTSTRAP_ADMIN_EMAIL`，打印一次性设密链接到日志 |
| OIDC | `oidc_providers(tenantId?, issuer, clientId, clientSecretCiphertext, scopes, claimMapping)`；Authorization Code + PKCE；`user_identities(provider, subject)` 关联用户 |
| 账号合并 | OIDC 首次登录：email 已存在且 `email_verified=true` → 关联已有用户；否则仅当租户开启 `autoProvision` 时新建 |
| 方式开关 | `tenants.settings.allowedLoginMethods = ['password','oidc:<id>']` |

```plantuml
@startuml oidc
autonumber
actor U
participant "Hub Shell" as S
participant "hub-api" as H
participant "IdP" as I
database PG

U -> S : 点击「使用企业账号登录」
S -> H : GET /v1/auth/oidc/{providerId}/start
H -> H : 生成 state + PKCE verifier (Redis 10min)
H --> S : 302 → IdP authorize
S -> I : 登录
I --> H : GET /v1/auth/oidc/callback?code&state
H -> I : token 交换 (code + verifier)
H -> H : 校验 id_token (iss/aud/exp/nonce)
H -> PG : user_identities 查 (provider, sub)
alt 未关联
  H -> PG : 按 email 关联 / autoProvision 新建
end
H --> S : 302 /login/complete + refresh cookie
S -> H : POST /v1/auth/refresh → access JWT
@enduml
```

- 切换租户：`POST /v1/auth/switch-tenant {tenantId}` 重新签发 access（校验成员身份）。
- 项目角色不写入 JWT：成员变更需立即生效，改为 Redis 缓存 `pm:{projectId}:{userId}`（TTL 60s，成员变更时主动失效）。

## 3.3 角色模型

```plantuml
@startuml roles
left to right direction
rectangle Platform {
  (platform.admin)
}
rectangle Tenant {
  (tenant.owner) --> (tenant.admin) : 包含
  (tenant.admin) --> (tenant.member) : 包含
}
rectangle Project {
  (project.owner) --> (project.developer) : 包含
  (project.developer) --> (project.viewer) : 包含
}
(platform.admin) ..> (tenant.owner) : 运维视角\n(不读会话正文)
(tenant.admin) ..> (project.owner) : 隐式等价\n(管理面)
@enduml
```

> `tenant.admin` 在**管理面**等价于所有项目的 `project.owner`，但在**会话面**不具备读他人会话正文的权限（只能走审计接口看元数据）。

## 3.4 权限矩阵

| 能力（permission） | viewer | developer | p.owner | t.admin | 说明 |
|---|:-:|:-:|:-:|:-:|---|
| `project.read` | ✓ | ✓ | ✓ | ✓ | |
| `project.update` / `binding.manage` | | | ✓ | ✓ | |
| `member.manage` | | | ✓ | ✓ | |
| `issue.read` | ✓ | ✓ | ✓ | ✓ | |
| `issue.write`（建卡/改状态/指派） | | ✓ | ✓ | ✓ | |
| `issue.force_close` / 列策略 | | | ✓ | ✓ | |
| `common.read` | ✓ | ✓ | ✓ | ✓ | |
| `common.write`（非受保护前缀） | | ✓ | ✓ | ✓ | |
| `common.write_protected` / 配额 | | | ✓ | ✓ | |
| `workspace.own`（个人工作区） | | ✓ | ✓ | ✓ | viewer 首版不开会话 |
| `session.create` / `session.own` | | ✓ | ✓ | ✓ | 仅自己的 |
| `session.audit_meta` | | | ✓ | ✓ | 只看元数据 |
| `credential.project.use` | | ✓* | ✓ | ✓ | *受 `allowed_roles` 与 `credentialPolicy` 约束 |
| `credential.project.manage` | | | ✓ | ✓ | 只写不读 |
| `config.read_effective` | | ✓ | ✓ | ✓ | 合并预览 |
| `config.manage` / `config.apply` | | | ✓ | ✓ | |
| `instance.manage`（登记 external） | | | | ✓ | platform.admin 管全局 |
| `node.manage` | | | | | 仅 platform.admin |

## 3.5 授权判定流程

```plantuml
@startuml authz
start
:请求进入 (Bearer JWT | ApiKey);
:authn 中间件 → Principal{userId, tenantId, troles, scopes};
if (路由声明 platform 权限?) then (是)
  if (pa == true?) then (是)
    :放行;
    stop
  else
    :403;
    stop
  endif
endif
:从路径/资源推导 projectId;
:加载 ProjectMembership (Redis→PG);
if (tenant.admin 且属于管理面权限?) then (是)
  :视同 project.owner;
elseif (无成员关系?) then (是)
  :404;
  stop
endif
if (角色包含所需 permission?) then (否)
  :403;
  stop
endif
if (资源为 owner-scoped\n(Workspace/Session/UserCredential)?) then (是)
  if (resource.ownerUserId == userId?) then (否)
    :404 (不暴露存在性);
    stop
  endif
endif
if (ApiKey 主体?) then (是)
  if (scopes 包含该 permission?) then (否)
    :403;
    stop
  endif
endif
:放行 + 审计;
stop
@enduml
```

实现：Hono 路由声明式元数据

```ts
route.post('/v1/projects/:projectId/sessions',
  authz({ perm: 'session.create', project: p => p.param('projectId') }),
  handler)
```

## 3.6 成员移除的连锁处理

```plantuml
@startuml member-remove
autonumber
actor Owner
participant "hub-api" as H
database PG
queue "jobs" as Q
participant Runtime as R

Owner -> H : DELETE /v1/projects/{p}/members/{u}
H -> PG : 删除 membership；workspace.status=revoked
H -> H : 失效 pm 缓存；吊销该用户对该 workspace 的 SSE 连接
H -> Q : enqueue RevokeWorkspaceJob
Q -> PG : 查活跃 AgentSession
Q -> R : abort 每个活跃会话
Q -> R : 清除注入的 ProjectCredential (DELETE /auth/:id)
Q -> PG : session.status=aborted(reason=member_removed)
Q -> Q : 按策略 schedule 卷删除 (默认保留 7 天)
H --> Owner : 204
@enduml
```
