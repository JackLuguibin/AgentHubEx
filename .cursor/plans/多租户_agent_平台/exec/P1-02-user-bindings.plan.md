---
name: P1-02 用户多空间绑定
overview: 用户与多空间绑定对话框 + 邀请按邮箱复用账号。
todos:
  - id: members-tabs
    content: 成员页双 Tab：当前项目成员 | 用户与多空间绑定
    status: pending
  - id: binding-dialog
    content: 绑定对话框：多选租户→勾选项目并分别设角色（对齐 memberships.js）
    status: pending
  - id: invite-email-reuse
    content: 邀请 API/UI：按邮箱复用已有 User，不重复建号
    status: pending
  - id: cascade-last-owner-ui
    content: UI 呈现级联解绑与最后 owner 409 错误
    status: pending
  - id: rbac-gate
    content: 按 tenant.admin/project.owner 隐藏无权限操作
    status: pending
  - id: dod-bindings
    content: DoD：绑多租户多项目；撤租户绑定级联；拒删最后 owner
    status: pending
isProject: false
---
# P1-02 用户与多空间绑定

> **索引 todo**：`phase1-user-bindings` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P1-01-tenant-project-ui.plan.md) · [目录](README.md)

> 产品上下文：[02-domain-collaboration](../02-domain-collaboration.plan.md)

## 前置

- 上一本手册全部 todos 已完成且 DoD 通过。
- 必读 SoT：[03-Auth](../../../../docs/architecture/03-auth-rbac.md) · [02-Domain](../../../../docs/architecture/02-domain-model.md) · [16-API](../../../../docs/architecture/16-api-schema.md)

## 目标

对齐原型成员/归属对话框（见 [../../html/README.md](../../html/README.md)）。

## 落地步骤（与 todos 对应）

1. **members-tabs**：`members` 路由双视图。
2. **binding-dialog**：多选租户与项目角色。
3. **invite-email-reuse**：后端已有则前端接好；缺则补 API。
4. **cascade-last-owner-ui**：错误码文案。
5. **rbac-gate**：按钮级权限。
6. **dod-bindings**：见下。

## DoD 命令

```bash
pnpm --filter @agenthub/hub-api test -- membership
# 手工走通绑定对话框主路径
```

## 明确不做

- 不做会话分享；不做站内通知中心。

