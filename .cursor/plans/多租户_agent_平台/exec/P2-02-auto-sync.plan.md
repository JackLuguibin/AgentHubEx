---
name: P2-02 自动同步
overview: Bundle/公共空间变更推送、回滚、受保护前缀强化。
todos:
  - id: push-on-publish
    content: Bundle/公共空间 publish 后节流推送到在线工作区
    status: pending
  - id: rollback-safe
    content: 回滚仅恢复受管文件；用户自建文件不受影响
    status: pending
  - id: protected-prefixes
    content: 受保护前缀强制与审计完善
    status: pending
  - id: dod-autosync
    content: DoD：publish 后在线区自动同步；回滚验收同 A3 增强
    status: pending
isProject: false
---
# P2-02 自动同步

> **索引 todo**：`phase2-auto-sync` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P2-01-node-agent.plan.md) · [目录](README.md)
>
> **粒度**：骨架手册——实现前须精读 SoT；可将本 todos 再拆子任务。

## 前置

- P1-08 DoD 已通过（或本阶段前序手册已完成）。
- 必读 SoT：[07-Config](../../../../docs/architecture/07-config-bundle.md) · [08-Common](../../../../docs/architecture/08-common-space.md)

## 目标

Bundle/公共空间变更推送、回滚、受保护前缀强化。

## 落地步骤（与 todos 对应）

1. **push-on-publish**：见 architecture 指针与下方清单。
2. **rollback-safe**：见 architecture 指针与下方清单。
3. **protected-prefixes**：见 architecture 指针与下方清单。
4. **dod-autosync**：见 architecture 指针与下方清单。

## 实现清单

- BullMQ 任务队列
- 与 P1 ApplyJob 状态机兼容

## DoD

自动同步成功/失败可在配置中心与审计中观察到。

## 明确不做

- 不回退放宽 P1 隔离与凭据硬规则。

