---
name: P1-08 隔离与验收
overview: 多租户上下文隔离 + 停用/归档门禁 + 凭据不落浏览器；跑 A1–A16 与 N1–N4。
todos:
  - id: idor-tests
    content: 集成测 IDOR 矩阵：跨用户/跨租户 session/workspace/反代 → 404
    status: completed
  - id: lifecycle-gates
    content: 租户 suspended / 项目 archived 阻断会话并 abort（A13/A14）
    status: completed
  - id: cred-never-leak
    content: 审计 GET 凭据无 secret；前端无 Provider Key 持久化（A7）
    status: completed
  - id: quota-sse-cases
    content: 覆盖 QUOTA_EXCEEDED 与 SSE_CURSOR_STALE（A15/A16）
    status: completed
  - id: intranet-n1n4
    content: 按 18.7 执行 N1–N4；Worker allowlist + allowedProviderHosts
    status: completed
  - id: a1a16-checklist
    content: 跑通/记录 13.4 A1–A16 清单；失败项建跟踪
    status: completed
  - id: dod-mvp
    content: DoD：A1–A16 与 N1–N4 全通过或豁免已文档化
    status: completed
isProject: false
---

# P1-08 隔离测试与 MVP 验收

> **索引 todo**：`phase1-isolation-test` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P1-07-project-board.plan.md) · [目录](README.md)

> 产品上下文：[06-security-delivery](../06-security-delivery.plan.md)

## 前置

- 上一本手册全部 todos 已完成且 DoD 通过。
- 必读 SoT：[13-Accept](../../../../docs/architecture/13-roadmap-acceptance.md) · [18-Intranet](../../../../docs/architecture/18-intranet-offline.md) · [12-Security](../../../../docs/architecture/12-security-observability-deployment.md)

## 目标

P1 关门：隔离与内网验收全部达标后再进 P2。

## 落地步骤（与 todos 对应）

1. **idor-tests**：每资源 × {同租户他人, 跨租户, 无成员}。
2. **lifecycle-gates**：409 `TENANT_SUSPENDED` / `PROJECT_ARCHIVED`。
3. **cred-never-leak**：API + 前端审查。
4. **quota-sse-cases**：按 13.4。
5. **intranet-n1n4**：断公网演练；offline-bundle dry-run。
6. **a1a16-checklist**：勾选表写入 `docs/` 或 PR 描述。
7. **dod-mvp**：见下。

## DoD 命令

```bash
pnpm test:integration
pnpm test:e2e
# 按 docs/architecture/13-roadmap-acceptance.md §13.4 与 18.7 逐条勾选
```

## 明确不做

- 不开始 P2 Node Agent，除非本本 DoD 通过。

