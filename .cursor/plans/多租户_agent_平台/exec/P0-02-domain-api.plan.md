---
name: P0-02 Domain API
overview: apps/hub-api：User/Tenant/Project/Membership/Issue/凭据/实例 CRUD 与级联/最后 owner 规则。
todos:
  - id: extend-db-schema
    content: 扩展 packages/db：credentials/runtime/issues/sessions 等 P0 所需表（对齐 15）
    status: completed
  - id: scaffold-hub-api
    content: 创建 apps/hub-api：Hono + zod-openapi 骨架、中间件链、错误码
    status: completed
  - id: auth-routes
    content: 实现注册/登录/刷新 JWT 与 /v1/me（对齐 03/16）
    status: completed
  - id: tenant-project-crud
    content: 实现 Tenant/Project 生命周期 API（active/suspended/archived）
    status: completed
  - id: membership-rules
    content: 实现双层 Membership：邮箱复用、级联解绑、保护最后 owner
    status: completed
  - id: issue-cred-instance-api
    content: 实现 Issue/UserCredential/ProjectCredential/RuntimeInstance 基础 CRUD（密文只写）
    status: completed
  - id: seed-dev
    content: 新增开发 seed：平台管理员 + 示例租户/项目/成员
    status: completed
  - id: dod-api-tests
    content: DoD：级联/最后 owner 集成测绿；关键路由 OpenAPI/zod 校验通过
    status: completed
isProject: false
---

# P0-02 领域 API

> **索引 todo**：`phase0-domain` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P0-01-monorepo.plan.md) · [目录](README.md)

> 产品上下文：[02-domain-collaboration](../02-domain-collaboration.plan.md)

## 前置

- 上一本手册全部 todos 已完成且 DoD 通过（首本除外）。
- 必读 SoT：[02-Domain](../../../../docs/architecture/02-domain-model.md) · [03-Auth](../../../../docs/architecture/03-auth-rbac.md) · [15-DDL](../../../../docs/architecture/15-database-ddl.md) · [16-API](../../../../docs/architecture/16-api-schema.md)

## 目标

在 hub-api 落地控制面领域接口，会话 Facade 联调前可完成身份与空间管理。

## 落地步骤（与 todos 对应）

1. **extend-db-schema**：按 15 增加 P0 表：`user_credentials`、`project_credentials`、`runtime_instances`、`project_runtime_bindings`、`workspaces`、`agent_sessions`、`project_issues`、`hub_api_keys`（可先最小字段集）。
2. **scaffold-hub-api**：`apps/hub-api` — Hono、`@hono/zod-openapi`、pino、context 中间件（tenant/user）；统一错误形状（16）。
3. **auth-routes**：注册/登录/refresh；密码 argon2；JWT 声明含 userId/roles。
4. **tenant-project-crud**：租户 CRUD + suspend；项目 CRUD + archive；slug/key 约束。
5. **membership-rules**：TenantMembership / ProjectMembership；邀请按邮箱复用 User；取消租户绑定级联清项目绑定；最后 owner → 409。
6. **issue-cred-instance-api**：Issue 四态基础 CRUD；凭据 PUT/DELETE/GET 元数据（永不返回 secret）；RuntimeInstance 登记字段（mode/isolation 可先存，反代 P1）。
7. **seed-dev**：可重复 seed 脚本。
8. **dod-api-tests**：Vitest + testcontainers 或 compose 上的集成测。

## 路径清单

```text
apps/hub-api/src/{app,index,routes,middleware,services,seed}.ts
packages/db/src/schema/*
```

## DoD 命令

```bash
pnpm --filter @agenthub/hub-api test
# 手工：登录 → 建租户/项目 → 绑成员 → 撤租户绑定级联 → 拒删最后 owner
```

## 明确不做

- 不做 Facade 反代/SSE、不做 Config Apply、不做前端页。
- Claude worker / Node Agent 不在本步。

