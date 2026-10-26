---
name: 多租户 Agent 平台
overview: 双引擎强隔离 Agent 平台；内网/可离线默认交付；全 React SPA；公开开源栈（Hono/Drizzle/BullMQ 等）；Facade 会话；远程实例、配置、公共空间、看板、双凭据。
todos:
  - id: phase0-monorepo
    content: Phase0：pnpm/Turborepo、compose.intranet、Drizzle、JWT/RBAC → exec/P0-01-monorepo.plan.md
    status: pending
  - id: phase0-domain
    content: Phase0：User/Tenant/Project/Membership/Issue/凭据/实例 API → exec/P0-02-domain-api.plan.md
    status: pending
  - id: phase0-react-spa
    content: Phase0：React SPA + workbench/agent-client + Facade 会话联调 → exec/P0-03-spa-facade-session.plan.md
    status: pending
  - id: phase0-offline-notes
    content: Phase0：offline-bundle 目录与私有 Registry 约定 → exec/P0-04-offline-notes.plan.md
    status: pending
  - id: phase1-tenant-project-mgmt
    content: Phase1：租户/项目管理页 + 顶栏切换器 → exec/P1-01-tenant-project-ui.plan.md
    status: pending
  - id: phase1-user-bindings
    content: Phase1：用户多空间绑定 + 邀请邮箱复用 → exec/P1-02-user-bindings.plan.md
    status: pending
  - id: phase1-external-proxy
    content: Phase1：实例登记（ADR-013）+ Facade 反代 → exec/P1-03-external-proxy.plan.md
    status: pending
  - id: phase1-config-apply
    content: Phase1：配置中心/发布下发/回滚 + agenthub-sync → exec/P1-04-config-apply.plan.md
    status: pending
  - id: phase1-common-fs
    content: Phase1：公共文件树+保护前缀+同步 → exec/P1-05-common-fs.plan.md
    status: pending
  - id: phase1-hub-shell-workbench
    content: Phase1：三组导航 + Workbench P1 接 Facade → exec/P1-06-workbench.plan.md
    status: pending
  - id: phase1-project-board
    content: Phase1：看板四列 + 人工确认 + Issue 开会话 → exec/P1-07-project-board.plan.md
    status: pending
  - id: phase1-isolation-test
    content: Phase1：隔离/门禁/凭据 + A1–A16/N1–N4 → exec/P1-08-isolation-acceptance.plan.md
    status: pending
  - id: phase2-node-agent
    content: Phase2：Node Agent managed/调度/配额 → exec/P2-01-node-agent.plan.md
    status: pending
  - id: phase2-auto-sync
    content: Phase2：Bundle/公共空间自动推送与回滚 → exec/P2-02-auto-sync.plan.md
    status: pending
  - id: phase2-workbench-rich
    content: Phase2：Workbench 编辑/diff/终端 → exec/P2-03-workbench-rich.plan.md
    status: pending
  - id: phase3-worker-claude
    content: Phase3：worker/claude + adapter 契约 → exec/P3-01-worker-claude.plan.md
    status: pending
  - id: phase3-llm-proxy
    content: Phase3：LLM Proxy + 凭据来源计量 → exec/P3-02-llm-proxy.plan.md
    status: pending
  - id: phase4-prod
    content: Phase4：mTLS/KMS/OTel/告警/可选 K8s → exec/P4-01-prod-hardening.plan.md
    status: pending
isProject: false
---

# AgentHubEx 多租户 Agent 平台方案

> **细节 SoT**：[`docs/architecture/`](../../docs/architecture/README.md)。  
> **编码入口**：按 [`多租户_agent_平台/exec/README.md`](多租户_agent_平台/exec/README.md) 顺序执行；**实现级 todos 在各 exec 手册 frontmatter**。本文件为阶段索引；与 architecture 冲突时以 architecture 为准。

双引擎强隔离 Agent 平台：内网/可离线默认交付；全 React SPA；公开开源栈；Facade 会话；远程实例、配置、公共空间、看板、双凭据。

## 执行顺序（编码只走这条）

| 序 | 手册 | 阶段 todo |
|---|---|---|
| 1 | [P0-01](多租户_agent_平台/exec/P0-01-monorepo.plan.md) | `phase0-monorepo` |
| 2 | [P0-02](多租户_agent_平台/exec/P0-02-domain-api.plan.md) | `phase0-domain` |
| 3 | [P0-03](多租户_agent_平台/exec/P0-03-spa-facade-session.plan.md) | `phase0-react-spa` |
| 4 | [P0-04](多租户_agent_平台/exec/P0-04-offline-notes.plan.md) | `phase0-offline-notes` |
| 5 | [P1-01](多租户_agent_平台/exec/P1-01-tenant-project-ui.plan.md) | `phase1-tenant-project-mgmt` |
| 6 | [P1-02](多租户_agent_平台/exec/P1-02-user-bindings.plan.md) | `phase1-user-bindings` |
| 7 | [P1-03](多租户_agent_平台/exec/P1-03-external-proxy.plan.md) | `phase1-external-proxy` |
| 8 | [P1-04](多租户_agent_平台/exec/P1-04-config-apply.plan.md) | `phase1-config-apply` |
| 9 | [P1-05](多租户_agent_平台/exec/P1-05-common-fs.plan.md) | `phase1-common-fs` |
| 10 | [P1-06](多租户_agent_平台/exec/P1-06-workbench.plan.md) | `phase1-hub-shell-workbench` |
| 11 | [P1-07](多租户_agent_平台/exec/P1-07-project-board.plan.md) | `phase1-project-board` |
| 12 | [P1-08](多租户_agent_平台/exec/P1-08-isolation-acceptance.plan.md) | `phase1-isolation-test` |
| 13 | [P2-01](多租户_agent_平台/exec/P2-01-node-agent.plan.md) | `phase2-node-agent` |
| 14 | [P2-02](多租户_agent_平台/exec/P2-02-auto-sync.plan.md) | `phase2-auto-sync` |
| 15 | [P2-03](多租户_agent_平台/exec/P2-03-workbench-rich.plan.md) | `phase2-workbench-rich` |
| 16 | [P3-01](多租户_agent_平台/exec/P3-01-worker-claude.plan.md) | `phase3-worker-claude` |
| 17 | [P3-02](多租户_agent_平台/exec/P3-02-llm-proxy.plan.md) | `phase3-llm-proxy` |
| 18 | [P4-01](多租户_agent_平台/exec/P4-01-prod-hardening.plan.md) | `phase4-prod` |

从 [exec/README.md](多租户_agent_平台/exec/README.md) 打开**当前**手册执行；未获指示前不要提前执行后续手册。

## 主题 plan（只读上下文，非执行序）

| # | 文档 | 内容 |
|---|---|---|
| 01 | [目标与架构](多租户_agent_平台/01-goals-architecture.plan.md) | 目标与约束、总体架构、Worker/Adapter 布局 |
| 02 | [领域与协作](多租户_agent_平台/02-domain-collaboration.plan.md) | 领域模型、绑定、看板、公共空间、配置、凭据、会话、RBAC |
| 03 | [Facade 与实例](多租户_agent_平台/03-facade-isolation-instances.plan.md) | Facade、强隔离工作区、external/managed |
| 04 | [前端 SPA](多租户_agent_平台/04-frontend.plan.md) | 全站 React SPA、Workbench、Hub Shell IA |
| 05 | [技术栈与仓库](多租户_agent_平台/05-stack-repo.plan.md) | 技术栈摘要、monorepo 目录 |
| 06 | [安全与交付](多租户_agent_平台/06-security-delivery.plan.md) | 安全硬规则、分阶段、验收、明确不做 |

## 其它入口

- **架构细节**：[`docs/architecture/`](../../docs/architecture/README.md)
- **交互原型（评审用）**：[`.cursor/plans/html`](html/README.md)
