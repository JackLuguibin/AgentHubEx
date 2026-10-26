---
name: P1-06 Workbench P1
overview: 三组导航 Shell + React Workbench（流式/权限/文件树）接 Facade。
todos:
  - id: nav-three-groups
    content: 侧栏三组导航全页路由接通（工作空间+项目配置）
    status: pending
  - id: wb-session-creds
    content: Workbench：选凭据开会话、本人会话 CRUD、busy 禁切凭据
    status: pending
  - id: wb-stream-perm
    content: 流式 assistant/tool 事件 + 权限允许/拒绝弹窗
    status: pending
  - id: wb-files-preview
    content: 只读文件树+文本预览（个人区 vs project-common）
    status: pending
  - id: wb-sync-actions
    content: 工作台内同步配置/公共资料入口（写审计）
    status: pending
  - id: capabilities-degrade
    content: 按 Workspace.capabilities 隐藏不可用入口
    status: pending
  - id: dod-workbench
    content: DoD：A10 阻断路径；会话 SSE 仅 Facade；无裸节点（A12）
    status: pending
isProject: false
---
# P1-06 Hub Shell 与 Workbench P1

> **索引 todo**：`phase1-hub-shell-workbench` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P1-05-common-fs.plan.md) · [目录](README.md)

> 产品上下文：[04-frontend](../04-frontend.plan.md)

## 前置

- 上一本手册全部 todos 已完成且 DoD 通过。
- 必读 SoT：[10-Frontend](../../../../docs/architecture/10-frontend.md) · [04-Facade](../../../../docs/architecture/04-gateway-facade.md) · [06-Creds](../../../../docs/architecture/06-credentials.md)

## 目标

对齐原型 workbench；P1 能力表见主题 plan / architecture 10。

## 落地步骤（与 todos 对应）

1. **nav-three-groups**：overview/board/workbench/instances/config/files/members/credentials/audit/settings。
2. **wb-session-creds**：双凭据 options API。
3. **wb-stream-perm**：runtime-contract 事件。
4. **wb-files-preview**：agent 白名单 file/find。
5. **wb-sync-actions**：触发 Apply/sync-common。
6. **capabilities-degrade**：无 PTY 则隐藏终端。
7. **dod-workbench**：A10/A12。

## DoD 命令

```bash
pnpm --filter @agenthub/workbench test
# Playwright 或手工：登录→会话→权限→文件预览；尝试违规 /agent 路径被拒
```

## 明确不做

- P2 编辑器/diff/完整终端；不对齐 OpenCode Desktop 全量 IDE。

