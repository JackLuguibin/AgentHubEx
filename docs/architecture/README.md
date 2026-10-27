# AgentHubEx 架构文档

> **实现执行手册**：[`.cursor/plans/多租户_agent_平台/exec/`](../../.cursor/plans/多租户_agent_平台/exec/README.md)（按 Phase 依次落地代码）。
>
> 来源：产品方案索引 [`.cursor/plans/多租户_agent_平台_c205364b.plan.md`](../../.cursor/plans/多租户_agent_平台_c205364b.plan.md)（正文拆于 [`.cursor/plans/多租户_agent_平台/`](../../.cursor/plans/多租户_agent_平台/)）。本目录把方案拆成可落地的详细设计，所有图使用 PlantUML（可用 VS Code PlantUML 插件、IntelliJ 或 `plantuml` CLI 渲染）。

## 文档索引

| # | 文档 | 内容 |
|---|---|---|
| 00 | [00-decisions.md](00-decisions.md) | ADR：…011 内网/离线、**012 工作区基数**、**013 external 绑定**、**014 tenant.admin** |
| 01 | [01-system-overview.md](01-system-overview.md) | 系统上下文、容器视图、组件分层、仓库与包依赖 |
| 02 | [02-domain-model.md](02-domain-model.md) | 领域模型、数据库表设计、索引、多租户约束 |
| 03 | [03-auth-rbac.md](03-auth-rbac.md) | 认证、JWT、Hub API Key、RBAC 权限矩阵与判定流程 |
| 04 | [04-gateway-facade.md](04-gateway-facade.md) | Gateway/Facade 中间件链、反代、SSE、API 清单、错误码 |
| 05 | [05-runtime-instances.md](05-runtime-instances.md) | external/managed 实例、Node Agent、调度、生命周期状态机 |
| 06 | [06-credentials.md](06-credentials.md) | 双凭据模型、解析、加密、注入、轮换、LLM Proxy |
| 07 | [07-config-bundle.md](07-config-bundle.md) | Agent/MCP/Skill 配置中心、合并、渲染、Apply 引擎、agenthub-sync |
| 08 | [08-common-space.md](08-common-space.md) | 项目公共空间存储、RBAC、同步、回流 |
| 09 | [09-project-board.md](09-project-board.md) | 项目看板、Issue 状态机、与会话联动 |
| 10 | [10-frontend.md](10-frontend.md) | 全站 React 单 SPA（Shell + Workbench） |
| 11 | [11-runtime-contract.md](11-runtime-contract.md) | Worker/Adapter 统一契约、事件信封、双引擎映射 |
| 12 | [12-security-observability-deployment.md](12-security-observability-deployment.md) | 安全硬规则、威胁模型、观测、部署拓扑 |
| 13 | [13-roadmap-acceptance.md](13-roadmap-acceptance.md) | 分阶段交付、里程碑依赖、验收用例 |
| 14 | [14-workspace-git.md](14-workspace-git.md) | 工作区代码种子、Git 凭据 helper、会话分支、推送与 PR |
| 15 | [15-database-ddl.md](15-database-ddl.md) | PG DDL 可读对照（权威为 Drizzle schema）、索引、关键事务、RLS 预留 |
| 16 | [16-api-schema.md](16-api-schema.md) | 全部对外/内部 API 的字段级 Schema、示例、错误码 |
| 17 | [17-libraries.md](17-libraries.md) | 各层流行库锁定清单（ADR-010） |
| 18 | [18-intranet-offline.md](18-intranet-offline.md) | **内网 / 离线部署**、升级回滚、环境变量清单（ADR-011） |
| — | [../acceptance/p1-mvp.md](../acceptance/p1-mvp.md) | **P1 验收勾选**（A1–A16、N1–N4） |
| — | [exec 手册](../../.cursor/plans/多租户_agent_平台/exec/README.md) | **按 Phase 执行的实现手册**（含可勾选 todos） |

## 核心原则速览

1. **Hub 是唯一入口**：浏览器只访问 Hub；节点地址、节点密码、Provider Key 全部留在控制面。
2. **一人一引擎一工作区一实例**：`Project × User × RuntimeType → Workspace → RuntimeInstance`（ADR-012），强隔离。
3. **门户是配置 SoT**：Agent/MCP/Skill/AGENTS.md 由 Hub 合并渲染后下发。
4. **双引擎对等**：OpenCode 与 Claude Agent SDK 实现同一 `runtime-contract`。
5. **公开开源 + 少造轮子**：技术栈用公开 OSI 许可组件（见 [17](17-libraries.md)）；不闭源硬依赖；不自研 DS/队列/ORM/JWT；不 vendor OpenCode Web。
6. **内网优先**：默认无公网依赖；LLM/Git/镜像均内网化；可空气隔离安装（见 [18](18-intranet-offline.md)）。

## 术语

| 术语 | 含义 |
|---|---|
| Hub | 本平台（控制面 + 门面 + 前端） |
| Hub Shell | 唯一前端 SPA（管理面 + 挂载 Workbench） |
| Workbench | `packages/workbench` React 会话模块（Facade + agent 白名单 + runtime-contract） |
| Facade / Gateway | `apps/hub-api` 中对外 API 与反向代理层 |
| RuntimeInstance | 可连接的 OpenCode / Claude Worker 端点 |
| external | 门户登记的、他人部署的 `opencode serve` |
| managed | Node Agent 按需拉起的 Worker 容器 |
| ConfigBundle | 可版本化的 Agent/MCP/Skill/Instructions 配置包 |
| CommonSpace | 项目公共文件空间（S3） |
