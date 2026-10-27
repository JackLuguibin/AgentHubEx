---
name: P1-07 项目看板
overview: React 看板四列（dnd-kit）+人工确认评审/已解决+从 Issue 开本人会话。
todos:
  - id: board-api
    content: 完善 Issue API：状态机、resolutionNote、linkedSessionIds
    status: completed
  - id: board-ui-dnd
    content: 看板四列+折叠取消；dnd-kit 拖拽改状态
    status: completed
  - id: board-filters
    content: 列表/搜索/成员/优先级筛选与 ⌘K 搜问题
    status: completed
  - id: human-confirm
    content: 进入 in_review/done 须人工确认+说明；owner 可强制关闭
    status: completed
  - id: issue-open-session
    content: 从 Issue 创建本人关联会话（标题含 key）
    status: completed
  - id: dod-board
    content: DoD：A5/A6；他人仅见关联元数据不可读正文
    status: completed
isProject: false
---

# P1-07 项目看板

> **索引 todo**：`phase1-project-board` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P1-06-workbench.plan.md) · [目录](README.md)

> 产品上下文：[02-domain](../02-domain-collaboration.plan.md)

## 前置

- 上一本手册全部 todos 已完成且 DoD 通过。
- 必读 SoT：[09-Board](../../../../docs/architecture/09-project-board.md) · [10-Frontend](../../../../docs/architecture/10-frontend.md)

## 目标

对齐原型 board；非 Jira。

## 落地步骤（与 todos 对应）

1. **board-api**：状态校验。
2. **board-ui-dnd**：`@dnd-kit`。
3. **board-filters**：cmdk。
4. **human-confirm**：对话框。
5. **issue-open-session**：调 Facade 建会话并回写关联。
6. **dod-board**：A5/A6。

## DoD 命令

```bash
# 建 3 卡拖拽；从 PROJ-1 开会话；标题含 key；Issue→in_progress
```

## 明确不做

- 自定义无限状态机、燃尽图、实时协同编辑卡片正文。

