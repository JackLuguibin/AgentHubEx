# 实现执行手册（exec）

> **编码入口**：只按本目录顺序执行。主题摘要见 [`../`](../) 的 `01`–`06`；字段级 SoT 见 [`docs/architecture/`](../../../../docs/architecture/README.md)。

## SoT 优先级

1. [`docs/architecture/`](../../../../docs/architecture/README.md)（ADR / DDL / API / 验收）
2. 本目录 `exec/*.plan.md`（落地步骤与 YAML todos）
3. 主题 plan `01`–`06`（产品上下文）
4. [`.cursor/plans/html/`](../../html/README.md)（IA / 视觉原型，非正式栈）

冲突时以 architecture 为准，并回写对应 exec 手册。

## Todos 写法

每本 `*.plan.md` **禁止** `todos: []`：

| 规则 | 要求 |
|---|---|
| 数量 | P0/P1：5～12 条；P2–P4：3～6 条 |
| id | kebab-case，手册内唯一 |
| content | 动宾短句 + 产出物或验收点 |
| 顺序 | 与正文步骤一致；按 frontmatter 顺序执行 |
| status | 初始 `pending` |

**分层**：索引 [`多租户_agent_平台_c205364b.plan.md`](../../多租户_agent_平台_c205364b.plan.md) 为阶段级 todos；本目录为实现级 todos（真正勾选处）。

## 执行顺序

| 序 | 手册 | 索引 todo |
|---|---|---|
| 1 | [P0-01-monorepo.plan.md](P0-01-monorepo.plan.md) | `phase0-monorepo` |
| 2 | [P0-02-domain-api.plan.md](P0-02-domain-api.plan.md) | `phase0-domain` |
| 3 | [P0-03-spa-facade-session.plan.md](P0-03-spa-facade-session.plan.md) | `phase0-react-spa` |
| 4 | [P0-04-offline-notes.plan.md](P0-04-offline-notes.plan.md) | `phase0-offline-notes` |
| 5 | [P1-01-tenant-project-ui.plan.md](P1-01-tenant-project-ui.plan.md) | `phase1-tenant-project-mgmt` |
| 6 | [P1-02-user-bindings.plan.md](P1-02-user-bindings.plan.md) | `phase1-user-bindings` |
| 7 | [P1-03-external-proxy.plan.md](P1-03-external-proxy.plan.md) | `phase1-external-proxy` |
| 8 | [P1-04-config-apply.plan.md](P1-04-config-apply.plan.md) | `phase1-config-apply` |
| 9 | [P1-05-common-fs.plan.md](P1-05-common-fs.plan.md) | `phase1-common-fs` |
| 10 | [P1-06-workbench.plan.md](P1-06-workbench.plan.md) | `phase1-hub-shell-workbench` |
| 11 | [P1-07-project-board.plan.md](P1-07-project-board.plan.md) | `phase1-project-board` |
| 12 | [P1-08-isolation-acceptance.plan.md](P1-08-isolation-acceptance.plan.md) | `phase1-isolation-test` |
| 13 | [P2-01-node-agent.plan.md](P2-01-node-agent.plan.md) | `phase2-node-agent` |
| 14 | [P2-02-auto-sync.plan.md](P2-02-auto-sync.plan.md) | `phase2-auto-sync` |
| 15 | [P2-03-workbench-rich.plan.md](P2-03-workbench-rich.plan.md) | `phase2-workbench-rich` |
| 16 | [P3-01-worker-claude.plan.md](P3-01-worker-claude.plan.md) | `phase3-worker-claude` |
| 17 | [P3-02-llm-proxy.plan.md](P3-02-llm-proxy.plan.md) | `phase3-llm-proxy` |
| 18 | [P4-01-prod-hardening.plan.md](P4-01-prod-hardening.plan.md) | `phase4-prod` |

## Agent 执行约定

1. **只执行当前打开的这一本手册**：按 YAML `todos` 顺序实现并跑 **DoD**；未获指示前不要打开或执行其他手册。
2. 库与目录锁定：[17-libraries.md](../../../../docs/architecture/17-libraries.md)、[05-stack-repo](../05-stack-repo.plan.md)。
3. 硬规则：禁业务裸 SQL（ADR-009）；禁公网 CDN/字体/脚本（ADR-011）；浏览器不持节点密码与 Provider Key。
4. 验收总表：[13-roadmap-acceptance.md](../../../../docs/architecture/13-roadmap-acceptance.md)。
