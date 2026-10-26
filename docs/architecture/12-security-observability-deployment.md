# 12 安全、观测与部署

## 12.1 信任边界

```plantuml
@startuml trust
skinparam rectangle {
  BorderStyle dashed
}
rectangle "不可信：浏览器 / API 客户端" as Z0 {
  [Hub Shell]
  [Workbench]
}
rectangle "DMZ：入口" as Z1 {
  [TLS 终止 / WAF / Ingress]
}
rectangle "可信：控制面" as Z2 {
  [hub-api]
  [hub-jobs]
  database PG
  database Redis
  database S3
}
rectangle "半可信：数据面节点" as Z3 {
  [node-agent]
  [agenthub-sync]
}
rectangle "不可信：Agent 执行环境" as Z4 {
  [worker 容器 / external opencode]
}
[Hub Shell] --> [TLS 终止 / WAF / Ingress]
[Workbench] --> [TLS 终止 / WAF / Ingress]
[TLS 终止 / WAF / Ingress] --> [hub-api]
[hub-api] --> [node-agent] : mTLS
[agenthub-sync] --> [hub-api] : sync token, 出站
[hub-api] --> [worker 容器 / external opencode] : 内网 + 节点认证
@enduml
```

> Agent 执行环境视为**不可信**：它会运行 LLM 生成的命令，可能受提示注入。因此其中不放任何 Hub 凭证；Phase 3 后连 Provider Key 也不放。

## 12.2 威胁与对策（STRIDE 摘要）

| 威胁 | 场景 | 对策 |
|---|---|---|
| 越权 (IDOR) | 用户猜他人 sessionId/workspaceId | owner 校验 + 404；IDOR 集成测试阻断发布 |
| 跨租户泄露 | 漏写 tenant 过滤 | `scoped(ctx)` 强制 + RLS（P4）+ 测试矩阵 |
| 凭据泄露 | 响应/日志/前端带出 Key | 只写不读；SecretBuffer 脱敏；Gateway 阻断 `/auth`；响应裁剪 |
| 节点密码泄露 | Workbench 直连节点 | 节点仅内网，浏览器只连 Hub |
| SSRF | 登记 external URL 指向元数据服务 | DNS 解析后 IP 黑名单、出站代理、仅 admin 可登记 |
| 容器逃逸 | Agent 执行恶意命令 | 非 root、cap-drop、默认 seccomp、无 docker.sock（ADR-002：不防高级逃逸，接受该风险） |
| 横向移动 | 容器访问其他工作区 / 控制面 | `icc=false`；拒绝控制面网段与元数据；**intranet 档默认拒公网 + allowlist**（ADR-003/011） |
| 数据外传 | 提示注入外传代码/Key | 内网档无公网出口则难外传；仍不放真实 Key（P3 Proxy）、Git 凭据不落盘、DNS 审计 |
| 配置注入 | 恶意 MCP command | 发布校验 + 租户 MCP 命令白名单 + 审计 |
| 路径穿越 | 公共空间/zip/sync | `common-fs` 统一校验；sync 白名单；拒绝 symlink |
| 提示注入改公共资料 | Agent 写共享文件 | 只读挂载 + promote 需人工 |
| 重放 | refresh token 被盗 | refresh family 旋转 + 重放即吊销 |
| 抵赖 | 谁改了配置/凭据 | 全写操作审计（不含明文） |
| DoS | SSE/会话滥用 | 限流、并发上限、配额 |

## 12.3 审计事件清单

`auth.login/logout/refresh_reuse`、`member.add/remove/role_change`、`credential.create/rotate/delete/use(仅 id)`、`instance.register/update/disable/test`、`bundle.publish/rollback`、`apply.run`、`common.write/delete/restore/promote`、`issue.status_change`、`session.create/abort`、`permission.decision`、`workspace.create/revoke/delete`、`admin.audit_view`。

## 12.4 可观测性

```plantuml
@startuml otel
[hub-api] --> [OTel Collector] : traces/metrics/logs (OTLP)
[hub-jobs] --> [OTel Collector]
[node-agent] --> [OTel Collector]
[worker/*] --> [OTel Collector] : 仅指标 + 结构化日志 (无会话正文)
[OTel Collector] --> [Tempo / Jaeger]
[OTel Collector] --> [Prometheus]
[OTel Collector] --> [Loki]
[Prometheus] --> [Alertmanager]
[Grafana] --> [Tempo / Jaeger]
[Grafana] --> [Prometheus]
[Grafana] --> [Loki]
@enduml
```

**关键指标**

| 指标 | 类型 | 告警 |
|---|---|---|
| `hub_http_requests_total{route,code}` | counter | 5xx 比例 > 2% 5min |
| `hub_proxy_upstream_latency_seconds{instance}` | histogram | p95 > 2s |
| `hub_sse_connections{tenant}` | gauge | |
| `hub_instance_health{instance,state}` | gauge | unhealthy > 5min |
| `hub_workspace_provision_seconds` | histogram | p95 > 120s |
| `hub_apply_jobs_total{status}` | counter | failed 比例 > 10% |
| `hub_common_sync_total{status}` | counter | |
| `hub_llm_tokens_total{tenant,project,source}` | counter | 配额 80% / 100% |
| `node_capacity_free_ratio{node}` | gauge | < 10% |

日志规范：JSON，字段 `ts, level, requestId, traceId, tenantId, userId, route, msg`；禁止记录消息正文、凭据、节点密码。

## 12.5 部署拓扑

### 内网单机 / 小集群（Phase 0–1 默认，ADR-011）

无公网。镜像来自私有 Registry 或 `docker load`。LLM/Git 为内网服务。

```plantuml
@startuml deploy-compose
node "内网 Compose 主机" {
  [caddy :443] as C
  [hub-shell (静态, 自托管)] as S
  [hub-api :8080] as A
  [hub-jobs] as J
  database "postgres:16" as PG
  database "redis:7" as R
  database "minio" as M
  [node-agent (可选, 同机)] as N
}
node "内网推理 / Git" {
  [vLLM_or_Ollama_or_网关] as LLM
  [GitLab_or_Gitea] as GIT
}
node "内网 Server-X" {
  [opencode serve :4096] as O
  [agenthub-sync] as SY
}
C --> S
C --> A
A --> PG
A --> R
A --> M
J --> PG
J --> R
A --> O : 内网
SY --> A : 内网出站
A --> N
O --> LLM : allowlist
O --> GIT : allowlist
@enduml
```

离线包与验收见 [18](18-intranet-offline.md)。

### 生产（Phase 4）

```plantuml
@startuml deploy-prod
cloud "Ingress / LB + WAF" as LB
node "内网控制面集群" {
  [hub-shell x2 (自托管静态)] as S
  [hub-api x3 (HPA)] as A
  [hub-jobs x2] as J
  [llm-proxy x2] as LP
  [otel-collector] as OT
}
database "PostgreSQL HA\n(主从 + PITR)" as PG
database "Redis Sentinel / Cluster" as R
database "MinIO_or_S3兼容" as S3
cloud "内网 KMS/Vault" as KMS
node "Worker 节点池 A (managed)" {
  [node-agent] as N1
  [worker 容器 ...] as W1
}
node "Worker 节点池 B (managed, GPU)" {
  [node-agent] as N2
}
node "BYO 服务器" {
  [external opencode + agenthub-sync] as E
}
node "内网推理/Git" {
  [LLM网关] as LLM
  [GitLab_Gitea] as GIT
}
LB --> S
LB --> A
A --> PG
A --> R
A --> S3
A --> KMS
A --> N1 : mTLS
A --> N2 : mTLS
A --> W1 : 内网
A --> E : 私有链路
W1 --> LP : LLM
W1 --> LLM : allowlist
W1 --> GIT : allowlist
@enduml
```

- hub-api 无状态；SSE 连接粘性不是必须（事件通过 Redis Stream 补发）。
- 数据面保持 Docker + node-agent（ADR-002）；控制面可跑在 K8s 或 compose，二者不耦合。K8s 工作区 provider 不在规划内，如有需要另开 ADR。
- **默认 intranet**：Worker **不**默认访问公网；见 ADR-003/011 与 [18](18-intranet-offline.md)。

## 12.6 备份与恢复

| 数据 | 方式 | RPO / RTO |
|---|---|---|
| PostgreSQL | WAL 归档 + 每日全量 | 5 min / 1 h |
| S3 公共空间 | 版本化 + 跨区复制 | 15 min |
| 工作区卷 | 不承诺（代码以 git 为准）；可选每日快照 | — |
| KEK | KMS 托管，禁止导出 | — |
