---
name: P3-01 worker/claude
overview: apps/worker/claude 与 adapter/claude 对齐契约 + Bundle 映射。
todos:
  - id: worker-claude
    content: 实现 apps/worker/claude + 镜像 agenthub/worker-claude
    status: completed
  - id: adapter-claude
    content: packages/adapter/claude 事件归一为 runtime-contract Envelope
    status: completed
  - id: bundle-map
    content: ConfigBundle→Claude 系统提示/工具白名单/MCP 桥映射表
    status: completed
  - id: dod-contract
    content: DoD：契约测试双引擎通过（11.8）
    status: completed
isProject: false
---

# P3-01 worker/claude

> **索引 todo**：`phase3-worker-claude` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P2-03-workbench-rich.plan.md) · [目录](README.md)
>
> **粒度**：骨架手册——实现前须精读 SoT；可将本 todos 再拆子任务。

## 前置

- P1-08 DoD 已通过（或本阶段前序手册已完成）。
- 必读 SoT：[11-Contract](../../../../docs/architecture/11-runtime-contract.md) · [07-Config](../../../../docs/architecture/07-config-bundle.md)

## 目标

apps/worker/claude 与 adapter/claude 对齐契约 + Bundle 映射。

## 落地步骤（与 todos 对应）

1. **worker-claude**：见 architecture 指针与下方清单。
2. **adapter-claude**：见 architecture 指针与下方清单。
3. **bundle-map**：见 architecture 指针与下方清单。
4. **dod-contract**：见 architecture 指针与下方清单。

## 实现清单

- UI 可选 Claude runtimeType
- capabilities 降级策略

## DoD

见 13.3 P3；契约测试绿。

## 明确不做

- 不回退放宽 P1 隔离与凭据硬规则。

