---
name: P2-03 Workbench 增强
overview: 编辑器预览、差异、终端按 capabilities。
todos:
  - id: editor-preview
    content: 多标签代码预览/轻量编辑（Monaco 或 CodeMirror，见 17）
    status: completed
  - id: diff-view
    content: 差异视图接入工作台
    status: completed
  - id: pty-capabilities
    content: 按 capabilities 开放 /pty；无能力则隐藏
    status: completed
  - id: dod-rich-wb
    content: DoD：capabilities 驱动终端入口；P1 会话路径不回归
    status: completed
isProject: false
---

# P2-03 Workbench 增强

> **索引 todo**：`phase2-workbench-rich` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P2-02-auto-sync.plan.md) · [目录](README.md)
>
> **粒度**：骨架手册——实现前须精读 SoT；可将本 todos 再拆子任务。

## 前置

- P1-08 DoD 已通过（或本阶段前序手册已完成）。
- 必读 SoT：[10-Frontend](../../../../docs/architecture/10-frontend.md) · [11-Contract](../../../../docs/architecture/11-runtime-contract.md)

## 目标

编辑器预览、差异、终端按 capabilities。

## 落地步骤（与 todos 对应）

1. **editor-preview**：见 architecture 指针与下方清单。
2. **diff-view**：见 architecture 指针与下方清单。
3. **pty-capabilities**：见 architecture 指针与下方清单。
4. **dod-rich-wb**：见 architecture 指针与下方清单。

## 实现清单

- 会话页布局对标 OpenCode Web：左会话、中对话、右本次改动/全部文件、底栏终端。不做 LSP、插件、分屏编辑器，不 vendor OpenCode Web

## DoD

见 13.3 P2 Workbench 增强行。

## 明确不做

- 不回退放宽 P1 隔离与凭据硬规则。

