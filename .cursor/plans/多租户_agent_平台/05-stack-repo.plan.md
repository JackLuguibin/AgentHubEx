---
name: 技术栈与仓库
overview: 公开开源技术栈摘要与 monorepo 落地目录。
todos: []
isProject: false
---

# 技术栈与仓库

> **细节 SoT**：字段级 API、DDL、ADR、验收与运维以 [`docs/architecture/`](../../../docs/architecture/README.md) 为准（含 ADR-012 工作区基数、ADR-013 external 绑定、ADR-014 角色名）。本文为产品/阶段摘要；与 architecture 冲突时以 architecture 为准并回写父索引与对应子 plan。
>
> **父索引**：[多租户 Agent 平台](../多租户_agent_平台_c205364b.plan.md)

> **执行入口（编码）**：请从 [`exec/README.md`](exec/README.md) 按序打开手册并勾选其 YAML todos；本文为产品主题摘要，**不是**执行顺序。

相关：[目标与架构](01-goals-architecture.plan.md) · [前端](04-frontend.plan.md) · [安全与交付](06-security-delivery.plan.md)

## 技术栈（公开开源 + 流行库，ADR-010）

完整清单与许可约定见 [docs/architecture/17-libraries.md](../../../docs/architecture/17-libraries.md)。摘要（均为公开项目）：

| 层 | 选型（流行组件） | 说明 |
|---|---|---|
| Monorepo | pnpm + Turborepo | |
| API | **Hono** + `@hono/zod-openapi` + zod | 不自研框架 |
| DB | PostgreSQL 16 + **Drizzle** + postgres.js | 禁止业务裸 SQL（ADR-009） |
| 队列 / 缓存 | Redis 7 + **BullMQ** + ioredis | Apply/Sync/健康任务 |
| 对象存储 | MinIO + `@aws-sdk/client-s3` | |
| 鉴权密码 | **jose**（JWT）+ **@node-rs/argon2** | 不自研加密 |
| 限流 | `rate-limiter-flexible` | Redis 后端 |
| 日志 / 观测 | **pino** + OpenTelemetry JS | |
| 前端 | React 19 + Vite + React Router | 单 SPA |
| UI | **shadcn/ui** + Radix + Tailwind + lucide | 不自研 DS |
| 数据/表/拖拽 | TanStack Query/Table + RHF + **dnd-kit** + cmdk + sonner | |
| HTTP / SSE | **ky** + `@microsoft/fetch-event-source` | |
| Markdown / 高亮 | react-markdown + remark-gfm + shiki | Workbench 消息 |
| 测试 | Vitest + Testing Library + MSW + Playwright | |
| Node Agent | **dockerode** + Hono | |
| GitHub API | **octokit** | PR/仓库 |
| Workbench | `packages/workbench`（业务壳） | 只组合上表库 + Facade |
| 设计原型 | [`.cursor/plans/html`](../html/) | 仅 IA/视觉 |

**自研边界**：多租户 Facade/RBAC 编排、runtime adapter、ConfigBundle 语义、Workbench 布局；其余优先表内库。

## 仓库结构（落地时创建）

```text
AgentHubEx/
  apps/
    hub-shell/         # 唯一前端 SPA（管理面路由 + 挂载 workbench）
    hub-api/           # Facade + Control Plane + Config Apply
    node-agent/        # 托管编排 + 文件型配置写入
    agenthub-sync/     # external 实例侧轻量配置同步 sidecar
    worker/
      common/
      opencode/
      claude/
  packages/
    db/                # Drizzle schema + 迁移 + db 客户端（ADR-009）
    workbench/         # React 会话 IDE 模块
    agent-client/      # Hub agent REST/SSE 客户端
    hub-ui-kit/        # shadcn 业务组合
    config-bundle/
    common-fs/
    domain/
    auth/
    runtime-contract/  # 统一会话/事件/capabilities（前后端共用类型）
    adapter/
      common/
      opencode/
      claude/
  deploy/
    docker/
    compose/
  docs/
```
