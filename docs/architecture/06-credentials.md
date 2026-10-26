# 06 凭据模型

## 6.1 两类 Provider 凭据 + 其它秘密

| 类型 | 所有者 | 可写 | 可用 | 明文可读 |
|---|---|---|---|---|
| UserCredential | 用户 | 本人 | 本人在任意有权项目 | 永不 |
| ProjectCredential | 项目 | project.owner / tenant.admin | `allowed_roles` 内成员 | 永不 |
| 实例节点认证 | 平台/租户 | instance.manage | Gateway 内部 | 永不 |
| MCP secretRef 目标 | 项目凭据 / vault | config.manage | Apply 引擎 | 永不 |
| HubApiKey | 租户 | t.admin | API 调用 | 仅创建时显示一次 |

## 6.2 加密方案（信封加密）

```plantuml
@startuml envelope
rectangle "KEK (Key Encryption Key)\nPhase1: env AGENTHUB_MASTER_KEY\nPhase4: KMS" as KEK
rectangle "DEK per tenant\n(加密后存 tenants.dek_ciphertext)" as DEK
rectangle "secret_ciphertext\nAES-256-GCM(DEK, plaintext, aad)" as CT
KEK --> DEK : wrap/unwrap
DEK --> CT : encrypt/decrypt
note bottom of CT
aad = tenantId|credentialKind|credentialId|version
防止密文被挪用到其它行
key_version 字段支持 KEK 轮换后惰性重加密
end note
@enduml
```

- 解密只在 `CredentialService` 内存中进行，返回 `SecretBuffer`（用后 `fill(0)`），日志序列化器对其输出 `[REDACTED]`。
- API 只返回 `{id, label, provider, status, isDefault, metadata, last4?}`。

## 6.3 解析算法

```plantuml
@startuml resolve
start
:输入 user, project, request{source?, id?};
:policy = project.credentialPolicy;
if (request 指定 source+id?) then (是)
  if (source 与 policy 冲突?) then (是)
    :409 CREDENTIAL_POLICY_VIOLATION;
    stop
  endif
  if (source == user) then
    :校验 credential.userId == user;
  else
    :校验 credential.projectId == project\n且 user.role ∈ allowedRoles;
  endif
  if (status != active?) then (是)
    :409 CREDENTIAL_REQUIRED;
    stop
  endif
  :返回 ref;
  stop
endif
if (用户在该项目有 preferredCredentialRef\n且有效且符合 policy?) then (是)
  :返回 ref;
  stop
endif
if (policy != user_only\n且项目存在 isDefault 凭据\n且 role 允许?) then (是)
  :返回项目默认 ref;
  stop
endif
if (policy == user_only 或 user_or_project) then (是)
  if (用户该 provider 只有一个 active 个人凭据?) then (是)
    :返回该 ref;
    stop
  endif
endif
:409 CREDENTIAL_REQUIRED\n(details: 可选列表/联系 owner);
stop
@enduml
```

返回值 `CredentialRef = {source, id, version}` 写入 `agent_sessions`，会话生命周期内锁定。

## 6.4 注入

```plantuml
@startuml inject
autonumber
participant Facade as F
participant CredentialSvc as C
participant "Adapter" as A
participant "Runtime" as R

F -> C : inject(instance, ref)
C -> C : 加载 credential_versions[ref.version]\n解密 → SecretBuffer
alt runtimeType == opencode (managed / external)
  C -> A : setProviderAuth(provider, {type:'api', key})
  A -> R : PUT /auth/{provider}  (Gateway 内网，不经浏览器)
else runtimeType == claude
  C -> A : setSessionCredential(sessionId, {provider, key, baseUrl})
  A -> R : POST /v1/internal/credentials (worker 内存保存，绑定 sessionId)
end
C -> C : buffer.fill(0)
C -> C : 记录 instance.injectedRef = ref (Redis)\n避免重复注入
@enduml
```

> **OpenCode 注意**：`/auth` 为实例级而非会话级。由于一人一实例，同一实例上该用户切换凭据时，Hub 在下一条 message 前比较 `injectedRef` 与 `session.credentialRef`，不同则重新注入（同一用户的多个会话使用不同凭据时串行化消息发送前的注入）。Phase 3 LLM Proxy 后消除该问题。

## 6.5 轮换

```plantuml
@startuml rotate
autonumber
actor Owner
participant "hub-api" as H
database PG
participant Runtime as R

Owner -> H : PUT /v1/projects/{p}/credentials/{id} {secret, rotationMode}
H -> PG : INSERT credential_versions(version=n+1)\nUPDATE project_credentials.version=n+1
alt rotationMode == graceful (默认)
  note over H : 旧会话继续使用 version n\n直到会话结束或旧版本被 revoke
else rotationMode == immediate
  H -> PG : 标记 version n revoked
  H -> PG : 查找 credential_version=n 的活跃会话
  H -> R : 下一条 message 时返回 409 CREDENTIAL_ROTATED\n前端提示重选（或自动升级到 n+1，可配置）
end
H --> Owner : 200 {version: n+1}
@enduml
```

## 6.6 Phase 3：LLM Proxy

```plantuml
@startuml llm-proxy
autonumber
participant Runtime as R
participant "LLM Proxy\n(hub-api 子服务)" as P
participant CredentialSvc as C
participant "Provider API" as L
database PG

note over R : 容器内仅持有\nproxy token (JWT, 1h, 绑定 sessionId/workspaceId)\nbaseURL=https://hub-internal/llm/{provider}
R -> P : POST /llm/anthropic/v1/messages\nAuthorization: Bearer proxyToken
P -> P : 校验 token，取 session.credentialRef
P -> P : 配额检查 (租户/项目/用户)
P -> C : 解密真实 Key
P -> L : 转发 (流式)
L --> P : stream
P --> R : stream 透传
P -> PG : UsageRecord(credentialSource, credentialId, tokens, cost)
@enduml
```

收益：真实 Key 永不进容器；可精确计量与硬限额；会话级凭据自然隔离。

## 6.7 计量维度

`usage_records` 聚合视图：

- 个人 Key 消耗：`credential_source='user'` 按 user 汇总（仅本人可见）。
- 项目 Key 消耗：`credential_source='project'` 按 project/user 汇总（owner 可见）。
- Phase 1–2 数据来源：解析 OpenCode/Claude 事件中的 usage 字段（尽力而为）；Phase 3 以 Proxy 为准。
- **租户日 token 配额**与超限硬拦语义见 [04 §4.8.1](04-gateway-facade.md)（与本表同源累加）。
- 首版**只计量不结算**：提供只读 usage 聚合 API（见 [16](16-api-schema.md)），不做收银台/发票。

## 6.8 KEK / 凭据运维轮换（Runbook 摘要）

| 步骤 | 动作 |
|---|---|
| 1 | 生成新 KEK（Phase1：新 `AGENTHUB_MASTER_KEY_V{n}`；Phase4：KMS 新密钥版本），配置**双窗口**（旧+新均可 unwrap） |
| 2 | `hub-jobs` 跑 `ReencryptCredentialsJob`：按 `key_version` 惰性或全表重包 DEK/密文，写新 `key_version` |
| 3 | 监控 `credentials.key_version` 分布；旧版本归零后移除旧 KEK |
| 4 | 回滚：双窗口未关闭前可切回旧 KEK；已重加密行仍可用新 KEK 读 |
| 同步 | 节点 mTLS 证书续期、sync token rotate、HubApiKey 轮换检查表见 [12 §12.8](12-security-observability-deployment.md) |
