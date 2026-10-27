---
name: P1-03 External 实例反代
overview: 运行实例登记（isolation+项目绑定，ADR-013）+ Facade 反代白名单。
todos:
  - id: instances-ui
    content: 运行实例页：登记表单 URL/认证/isolation/项目绑定/测活
    status: completed
  - id: instance-api
    content: 完善 RuntimeInstance + ProjectRuntimeBinding API（ADR-013）
    status: completed
  - id: health-probe
    content: Hub 探测 /global/health；离线实例阻断配置下发入口
    status: completed
  - id: agent-proxy-allowlist
    content: 实现 /v1/workspaces/:id/agent/* 白名单反代；阻断 session/event/auth
    status: completed
  - id: workspace-me
    content: GET workspaces/me：懒创建 Workspace + capabilities
    status: completed
  - id: dod-proxy
    content: DoD：dedicated 绑定后经 Facade 访问文件类路径；浏览器无节点地址/密码
    status: completed
isProject: false
---

# P1-03 远程实例登记与 Facade 反代

> **索引 todo**：`phase1-external-proxy` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P1-02-user-bindings.plan.md) · [目录](README.md)

> 产品上下文：[03-facade-isolation](../03-facade-isolation-instances.plan.md)

## 前置

- 上一本手册全部 todos 已完成且 DoD 通过。
- 必读 SoT：[04-Facade](../../../../docs/architecture/04-gateway-facade.md) · [05-Runtime](../../../../docs/architecture/05-runtime-instances.md) · [00-ADR](../../../../docs/architecture/00-decisions.md)

## 目标

MVP 主路径：external OpenCode 登记即连（managed 留 P2）。

## 落地步骤（与 todos 对应）

1. **instances-ui**：对齐原型 instances。
2. **instance-api**：`isolation=dedicated|shared`；intranet 禁止新建 shared（或强警告）。
3. **health-probe**：状态写入实例。
4. **agent-proxy-allowlist**：04 白名单；403 `BLOCKED_UPSTREAM_PATH`。
5. **workspace-me**：ADR-012 一人一引擎工作区。
6. **dod-proxy**：验收 A1 部分（会话历史可随后续）。

## DoD 命令

```bash
# 登记 opencode serve → 项目绑定 → curl -H JWT Hub /v1/workspaces/{id}/agent/file/...
# 确认尝试 /agent/event 或 POST /agent/session → 403
```

## 明确不做

- Node Agent managed 编排（P2-01）；Claude 实例可选（P3）。

