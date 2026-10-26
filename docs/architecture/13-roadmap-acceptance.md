# 13 分阶段交付与验收

## 13.1 里程碑甘特（估算）

```plantuml
@startgantt roadmap
Project starts 2026-11-02
saturday are closed
sunday are closed

-- Phase 0 骨架 --
[P0 monorepo/compose/schema/JWT-RBAC] as [p0a] lasts 5 days
[P0 领域 API] as [p0b] lasts 5 days
[p0b] starts at [p0a]'s end
[P0 React SPA + workbench/agent-client 骨架] as [p0c] lasts 5 days
[p0c] starts at [p0a]'s start
[P0 Facade 会话联调（opencode serve）] as [p0d] lasts 4 days
[p0d] starts at [p0c]'s end

-- Phase 1 MVP --
[P1 远程实例登记 + Facade 反代/SSE] as [p1a] lasts 10 days
[p1a] starts at [p0b]'s end
[P1 双凭据注入] as [p1b] lasts 5 days
[p1b] starts at [p1a]'s start
[P1 配置中心 + Apply + agenthub-sync] as [p1c] lasts 12 days
[p1c] starts at [p0b]'s end
[P1 公共空间 + 同步] as [p1d] lasts 8 days
[p1d] starts at [p0b]'s end
[P1 React Workbench MVP] as [p1e] lasts 10 days
[p1e] starts at [p1a]'s start
[P1 项目看板 + Issue 开会话] as [p1f] lasts 8 days
[p1f] starts at [p0c]'s end
[P1 隔离与凭据验收] as [p1g] lasts 4 days
[p1g] starts at [p1c]'s end

-- Phase 2 --
[P2 Node Agent managed + 调度 + 配额] as [p2a] lasts 15 days
[p2a] starts at [p1g]'s end
[P2 自动推送/回滚/受保护前缀] as [p2b] lasts 8 days
[p2b] starts at [p1g]'s end

-- Phase 3 --
[P3 worker/claude 对齐 + Bundle 映射] as [p3a] lasts 15 days
[p3a] starts at [p2a]'s end
[P3 LLM Proxy + 计量] as [p3b] lasts 10 days
[p3b] starts at [p2a]'s end

-- Phase 4 --
[P4 mTLS/KMS/OTel/告警/K8s] as [p4] lasts 15 days
[p4] starts at [p3a]'s end
@endgantt
```

## 13.2 依赖关系

```plantuml
@startuml deps
rectangle "P0 骨架" as P0
rectangle "P1 external 反代" as A
rectangle "P1 凭据" as C
rectangle "P1 配置 Apply" as CF
rectangle "P1 公共空间" as CS
rectangle "P1 Workbench" as WB
rectangle "P1 看板" as B
rectangle "P1 验收" as V1
rectangle "P2 managed" as M
rectangle "P2 自动同步" as AS
rectangle "P3 worker/claude" as WC
rectangle "P3 LLM Proxy" as LP
rectangle "P4 生产加固" as P4
P0 --> A
P0 --> CF
P0 --> CS
P0 --> B
A --> C
A --> WB
C --> B : 从 Issue 开会话
CF --> V1
CS --> V1
WB --> V1
B --> V1
V1 --> M
V1 --> AS
M --> WC
M --> LP
C --> LP
WC --> P4
LP --> P4
@enduml
```

## 13.3 各阶段交付物与 DoD

| 阶段 | 交付物 | 完成定义 |
|---|---|---|
| P0 | monorepo、**compose.intranet**、Drizzle、JWT/RBAC、领域 CRUD、React SPA（无外链）、workbench 骨架、offline-bundle 约定 | `pnpm dev` + intranet compose；RBAC 单测；Facade 流式会话；静态检查无公网 URL |
| P1 | external 反代 + SSE、双凭据、配置 Apply、公共空间、React Workbench MVP、看板 | 13.4 中 **A1–A16** 与 **N1–N4**（见 [18.7](18-intranet-offline.md)）全通过 |
| P2 | node-agent、调度、配额、自动推送/回滚、Workbench 编辑/终端增强 | managed 工作区 p95 就绪 < 120s；capabilities 驱动终端入口 |
| P3 | worker/claude、Bundle 双引擎、LLM Proxy、计量 | 契约测试双引擎通过；容器内无 Provider Key |
| P4 | mTLS、KMS、RLS、OTel 告警（数据面保持 Docker，见 ADR-002） | 渗透测试无高危；告警演练通过 |

## 13.4 首版（P1）验收用例

| ID | 场景 | 步骤 | 期望 |
|---|---|---|---|
| A1 | 远程登记即连 | 他机部署 opencode serve → 门户登记（`isolation=dedicated`，ADR-013）→ 项目绑定 → 成员进入 Workbench | 可对话；浏览器网络面板中无远程地址与节点密码；历史消息刷新后仍在（Hub `session_messages`） |
| A2 | 配置下发 | 项目 Bundle 加 1 Agent + 1 MCP + 1 Skill + AGENTS.md → 发布 → 同步 | 会话中能看到并使用；ApplyJob=succeeded |
| A3 | 回滚 | 回滚到上一 revision | 受管文件恢复；用户自建文件不受影响 |
| A4 | 公共空间 | 上传 docs/spec.md → 同步 | 工作区 `project-common/docs/spec.md` 存在；Agent 写入被拒 |
| A5 | 看板 | 建 3 卡，拖到不同列 | 计数正确；他人实时看到 |
| A6 | Issue 开会话 | PROJ-1 点开会话 | 会话标题含 PROJ-1；Issue→in_progress；关联可见 |
| A7 | 双凭据 | 用户 A 用个人 Key，用户 B 用项目 Key | usage 记录来源正确；GET 凭据接口无 secret |
| A8 | 用户隔离 | B 访问 A 的 sessionId / workspaceId / 反代路径 | 全部 404 |
| A9 | 租户隔离 | 租户 T2 用户访问 T1 任意资源 | 全部 404；审计有记录 |
| A10 | 阻断 | Workbench 尝试 `PUT /agent/auth/...`、`PATCH /agent/config`、`GET /agent/event`、`POST /agent/session` | 403 BLOCKED_UPSTREAM_PATH |
| A11 | 成员移除 | 移除 B | B 的活跃会话 abort；B 无法再进入工作区 |
| A12 | UI / 通道 | 代码审查 | 全站 React 单 SPA；shadcn 底层；会话 SSE 仅 Facade；文件走 agent 白名单；无裸 fetch |
| N1–N4 | 内网 / 离线 | 见 [18.7](18-intranet-offline.md) | 断公网可登录开会话；无浏览器公网请求；Worker allowlist；offline-bundle 可装 |
| A13 | 租户停用 | platform.admin suspend 租户 T1 | T1 成员无法开会话/发消息（409 `TENANT_SUSPENDED`）；进行中会话 abort；可切换到其他 active 租户 |
| A14 | 项目归档 / 最后 owner | 归档项目；尝试移除最后一名 project.owner / tenant.owner | 归档后拒开会话（409 `PROJECT_ARCHIVED`）；移除最后 owner → 409 |
| A15 | SSE 游标过期 | 制造 Stream 溢出或伪造过旧 Last-Event-ID | 收到 `SSE_CURSOR_STALE`；messages 对齐后可继续流式 |
| A16 | 日 token 配额 | 将租户 `tokensPerDay` 调极低并打满 | 新 message/session 429 `QUOTA_EXCEEDED`；进行中生成不强制 abort |

## 13.5 明确不做（首版）

- OpenCode 服务端内核多租户 ACL；
- Vendor / 嵌入 OpenCode Web 或异栈 iframe；浏览器经 `/agent` 打会话事件或创建会话；
- P1 对齐 OpenCode Desktop 全量 IDE（LSP/完整 PTY 等）；
- 自研 Design System / 拖拽底层；引入 Next.js/RSC；独立 `/wb/*` 路由；
- 完整 Jira 工作流、燃尽图；
- SSH 手改远程 `opencode.json`；
- 多人共容器、公共空间实时协同、会话分享、前端持久化 Key、计费收银台。
- 站内通知中心 / 邮件通知（密码重置 SMTP 除外）；**P2+** 再做（见 13.7）。

## 13.6 测试与 CI 门禁

| 层 | 工具 | 覆盖 |
|---|---|---|
| 单元 | Vitest | domain zod、RBAC、Bundle merge、common-fs 路径 |
| 契约 | 见 [11.8](11-runtime-contract.md) | 双引擎 + external |
| API 集成 | Vitest + testcontainers（PG/Redis） | IDOR 矩阵：每资源 × {同租户他人, 跨租户, 无成员} → 404/403 |
| 前端 | Testing Library + MSW；Playwright e2e | 登录→开会话→delta→权限；A10 阻断路径 |
| 静态 | ESLint（禁裸 SQL/禁公网 URL）；OpenAPI breaking diff；license/NOTICE 抽检 | intranet 友好 |
| 产物 | offline-bundle 构建 job（可夜间） | N4 安装脚本 dry-run |

## 13.7 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 上游 OpenCode API 变动 | 反代/adapter 失效 | 锁版本；OpenAPI diff；未知路径默认阻断；前端只认 runtime-contract |
| OpenCode `/auth` 实例级 | 同用户多凭据会话需串行注入 | P1 串行化；P3 LLM Proxy 根治 |
| 上游不支持热加载 agents/skills | Apply 需重启进程 | 会话 idle 时再重启；保留会话存储 |
| external 实例被共用 | 隔离失效 | `isolation=shared` 仅单活跃用户；正式环境禁止 |
| 自研 Workbench 范围膨胀 | P1 延期 | 严格 P1 能力表；P2+ 增强 |
| Claude SDK 能力与 OpenCode 不对等 | Workbench 体验差异 | capabilities 降级；契约测试 |
