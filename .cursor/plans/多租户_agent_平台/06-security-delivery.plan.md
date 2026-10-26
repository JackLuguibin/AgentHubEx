---
name: 安全与交付
overview: 安全硬规则、分阶段交付、首版验收与明确不做。
todos: []
isProject: false
---

# 安全与交付

> **细节 SoT**：字段级 API、DDL、ADR、验收与运维以 [`docs/architecture/`](../../../docs/architecture/README.md) 为准（含 ADR-012 工作区基数、ADR-013 external 绑定、ADR-014 角色名）。本文为产品/阶段摘要；与 architecture 冲突时以 architecture 为准并回写父索引与对应子 plan。
>
> **父索引**：[多租户 Agent 平台](../多租户_agent_平台_c205364b.plan.md)

> **执行入口（编码）**：请从 [`exec/README.md`](exec/README.md) 按序打开手册并勾选其 YAML todos；本文为产品主题摘要，**不是**执行顺序。

相关：[Facade 与实例](03-facade-isolation-instances.plan.md) · [前端](04-frontend.plan.md) · [父索引](../多租户_agent_平台_c205364b.plan.md)

## 安全与多租户 / 多用户硬规则

- **数据访问**：仅 Drizzle ORM（`packages/db`）；业务禁止手写 SQL（ADR-009）。
- 所有数据访问带 `tenant_id` 强制过滤；会话与工作区另加 `owner_user_id` 校验（行级约定 + 集成测试）。
- Workspace 路径与容器标签必须含 `tenantId` / `projectId` / `userId`；跨租户、跨用户 IDOR 作为阻断级测试。
- **禁止**把同一 OpenCode 容器共享给项目内多名用户充当多租户；首版一人一容器。
- **凭据**：密文落库；GET 接口永不返回 secret；浏览器与 Hub Web 不持有 Provider Key；审计日志只记凭据 id/label，不记明文。
- 用户不得读取他人 `UserCredential`；非 owner 不得读取 `ProjectCredential` 明文（任何人含 owner 的 GET 都不返明文，轮换靠覆盖写入）。
- 上游 OpenCode 节点密码/token 仅存于 Control Plane，只在 Gateway↔Node 内网使用。
- 权限请求（OpenCode permissions / Claude `canUseTool`）：只推送给 **会话 owner**，记录审计；可配租户级 auto-approve（默认否）。
- 项目成员变更（移除用户）时：停用其 Workspace 访问、abort 其活跃会话，卷按策略保留或延期删除；其个人凭据不受影响，但不可再选该项目的 ProjectCredential。

## 分阶段交付

### Phase 0 — 骨架（1 周）
- Monorepo、PG schema、Auth（JWT + RBAC）、**`compose.intranet.yml`**（`DEPLOY_PROFILE=intranet`）。
- 领域：全局 **User**、Tenant/Project、Membership、Issue/ConfigBundle/Credential/RuntimeInstance。
- React SPA（Vite + shadcn + TanStack + dnd-kit；**无外链字体/脚本**）；`workbench` + `agent-client` 骨架。
- 内网 `opencode serve` + 内网/mock LLM baseUrl，经 Facade 打通一条流式会话。
- 文档化 offline-bundle 目录与私有 Registry 导入（打包脚本可 P1）。

### Phase 1 — 对齐最新 html 原型的可运行门户 MVP
- 三组导航全页 + 用户多空间绑定。
- 实例登记与项目绑定（ADR-013）、配置下发、公共文件、看板人工确认。
- **React Workbench P1**：流式对话、权限、文件树预览、选凭据、关联 Issue。
- Worker allowlist + `allowedProviderHosts`；offline-bundle 最小可装。
- 验收：主路径 + 隔离/凭据 + **N1–N4 内网**（见 18.7）。

### Phase 2 — Node Agent 托管 + Workbench 增强
- Node Agent managed；Bundle/公共空间推送与回滚；配额与多节点。
- Workbench：编辑器预览/diff；按 capabilities 终端等。

### Phase 3 — worker/claude 对等 + Bundle 双引擎映射
- `apps/worker/claude` 对齐契约；LLM Proxy + 按凭据来源计量。

### Phase 4 — 生产加固
- mTLS、密钥轮换、OTel、告警；Config/凭据 KMS；可选 K8s。

## 首版验收标准

- **对照**最新 [`.cursor/plans/html`](../html/README.md)：三组导航、租户/项目管理、用户多空间绑定均可走通（真实后端）。
- 全局用户可绑多租户/多项目；项目绑定依赖租户成员；取消租户绑定级联清项目绑定；保护最后一名 owner；邀请按邮箱复用账号。
- 顶栏仅展示已绑定且可用空间；停用租户/归档项目阻断工作区并停止会话。
- 登记远程实例（`dedicated` + 项目绑定）；经「我的工作台」进会话，不知节点地址/密码。
- 配置下发、公共文件同步、看板人工确认评审/已解决、双凭据与隔离同前。
- 后续验收 Phase 2 托管节点与 Phase 3 Claude。

## 明确不做（首版）

- 在 OpenCode **服务端内核**里做多租户 ACL（多租户与配置 SoT 留在 Hub）。
- Vendor / 嵌入 OpenCode Web；浏览器经 `/agent` 打会话事件或创建会话；独立 `/wb/*`。
- P1 对齐 OpenCode Desktop 全量 IDE（LSP、完整终端等 → P2+ / capabilities）。
- 自研 Design System / 拖拽底层；引入 Next.js/RSC。
- 完整 Jira/线性工作流、自定义无限状态机、燃尽图等重项目管理。
- 要求运维 SSH 手改每台 `opencode.json`。
- 多人共容器；公共空间实时协同编辑；会话分享；前端持久化 Key；计费收银台。
