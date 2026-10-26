---
name: P0-01 Monorepo
overview: 初始化 pnpm/Turborepo、intranet compose、packages/db+auth+domain+runtime-contract 骨架与 RBAC 单测。
todos:
  - id: init-pnpm-turbo
    content: 初始化 pnpm-workspace + Turborepo + 根 tsconfig/eslint（禁公网 CDN）
    status: pending
  - id: compose-intranet
    content: 新增 deploy/compose/compose.intranet.yml（pg16/redis7/minio）与 DEPLOY_PROFILE=intranet
    status: pending
  - id: pkg-db-schema
    content: 创建 packages/db：users/tenants/projects/memberships Drizzle schema + migrate 脚本
    status: pending
  - id: pkg-auth-rbac
    content: 创建 packages/auth：jose JWT + @node-rs/argon2 + RBAC 矩阵 Vitest
    status: pending
  - id: pkg-domain-contract
    content: 创建 packages/domain 与 packages/runtime-contract 类型骨架（对齐 02/11）
    status: pending
  - id: root-scripts
    content: 根 package.json 脚本：dev/build/test/db:migrate/lint；turbo pipeline
    status: pending
  - id: dod-compose-migrate
    content: DoD：compose up 健康、pnpm db:migrate 成功、auth RBAC 单测绿
    status: pending
isProject: false
---
# P0-01 Monorepo 与基础包

> **索引 todo**：`phase0-monorepo` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：（首本） · [目录](README.md)

> 产品上下文：[05-stack-repo](../05-stack-repo.plan.md) · [01-goals](../01-goals-architecture.plan.md)

## 前置

- 上一本手册全部 todos 已完成且 DoD 通过（首本除外）。
- 必读 SoT：[15-DDL](../../../../docs/architecture/15-database-ddl.md) · [03-Auth](../../../../docs/architecture/03-auth-rbac.md) · [17-Libs](../../../../docs/architecture/17-libraries.md) · [18-Intranet](../../../../docs/architecture/18-intranet-offline.md)

## 目标

搭建可编译的 monorepo 与内网依赖，为 Hub API / SPA 提供 db、auth、领域类型。

## 落地步骤（与 todos 对应）

1. **init-pnpm-turbo**：仓库根 `package.json`、`pnpm-workspace.yaml`（`apps/*`、`packages/*`）、`turbo.json`、`tsconfig.base.json`、ESLint/Prettier；`.npmrc` 指向可离线/私有 registry 占位；禁止引入外链字体/脚本依赖约定写入 README。
2. **compose-intranet**：`deploy/compose/compose.intranet.yml` 启动 PostgreSQL 16、Redis 7、MinIO；文档化 `DEPLOY_PROFILE=intranet`（见 18）；健康检查端口与默认 env 示例 `.env.example`。
3. **pkg-db-schema**：`packages/db` 用 Drizzle + postgres.js；本步 schema **子集**：`users`、`tenants`、`projects`、`tenant_memberships`、`project_memberships`（字段对齐 15）；`pnpm db:migrate` / `db:generate` 脚本；禁止业务裸 SQL（ADR-009）。
4. **pkg-auth-rbac**：`packages/auth` — JWT（jose）、密码（argon2）、RBAC 判定函数（platform/tenant/project 角色，ADR-014）；Vitest 覆盖权限矩阵关键格。
5. **pkg-domain-contract**：`packages/domain` zod 实体骨架；`packages/runtime-contract` 会话/事件 Envelope 类型占位（11）。
6. **root-scripts**：turbo `build`/`test`/`lint` 管道；CI 本地可跑 `pnpm test --filter @agenthub/auth`。
7. **dod-compose-migrate**：见下。

## 路径清单

```text
package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json
deploy/compose/compose.intranet.yml, .env.example
packages/db/, packages/auth/, packages/domain/, packages/runtime-contract/
```

## DoD 命令

```bash
docker compose -f deploy/compose/compose.intranet.yml up -d
pnpm install
pnpm db:migrate
pnpm --filter @agenthub/auth test
```

全部成功且无公网 registry 硬依赖即可。

## 明确不做

- 不实现 hub-api 路由、不实现前端、不拉起 opencode。
- 不建全量 41 张表（凭据/会话/Issue 等表在 P0-02 扩展）。

