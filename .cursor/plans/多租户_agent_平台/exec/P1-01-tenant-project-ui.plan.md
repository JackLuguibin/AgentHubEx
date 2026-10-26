---
name: P1-01 租户项目管理 UI
overview: 租户管理/项目管理页 + 顶栏切换器（仅已绑定可用空间）。
todos:
  - id: pages-tenants
    content: 实现 tenants 页：列表/搜索/状态/配额/启停（对齐 html tenants）
    status: completed
  - id: pages-projects
    content: 实现 projects 页：创建编辑/归档恢复/引擎与凭据策略入口
    status: completed
  - id: topbar-switcher
    content: 顶栏租户/项目切换器：仅已绑定且 active/未归档空间
    status: completed
  - id: nav-platform-group
    content: Shell 侧栏「平台与组织」导航组接通路由
    status: completed
  - id: api-wire
    content: 前端 ky/Query 对接 P0 Tenant/Project API；错误 toast
    status: completed
  - id: dod-switcher
    content: DoD：切换空间刷新上下文；停用/归档空间不出现在切换器
    status: completed
isProject: false
---

# P1-01 租户 / 项目管理页

> **索引 todo**：`phase1-tenant-project-mgmt` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P0-04-offline-notes.plan.md) · [目录](README.md)

> 产品上下文：[04-frontend](../04-frontend.plan.md) · 原型 [../../html/README.md](../../html/README.md)

## 前置

- 上一本手册全部 todos 已完成且 DoD 通过。
- 必读 SoT：[10-Frontend](../../../../docs/architecture/10-frontend.md) · [03-Auth](../../../../docs/architecture/03-auth-rbac.md) · [16-API](../../../../docs/architecture/16-api-schema.md)

## 目标

对齐 [html 原型](../../html/README.md) 的租户/项目管理与顶栏上下文。

## 落地步骤（与 todos 对应）

1. **pages-tenants**：`/tenants`（或平台路由）CRUD UI；platform.admin 能力。
2. **pages-projects**：当前租户下项目列表；归档/恢复；详情快捷入口占位。
3. **topbar-switcher**：只列已绑定可用空间；无绑定时引导至管理页。
4. **nav-platform-group**：侧栏第一组导航。
5. **api-wire**：TanStack Query + ky；禁用态与 409 提示。
6. **dod-switcher**：见下。

## 路径清单

```text
apps/hub-shell/src/pages/{Tenants,Projects}Page.tsx
apps/hub-shell/src/components/TopbarSwitcher.tsx
```

## DoD 命令

```bash
pnpm --filter @agenthub/hub-shell test
# 手工：建租户/项目 → 切换器可见 → suspend/archive 后切换器消失且工作区入口阻断
```

## 明确不做

- 不做「用户与多空间绑定」对话框（P1-02）；不做 Workbench 增强。

