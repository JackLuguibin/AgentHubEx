---
name: P0-03 SPA + Facade 会话
overview: React SPA 骨架 + workbench/agent-client；Facade 打通一条流式会话（内网 opencode 或 mock）。
todos:
  - id: scaffold-hub-shell
    content: 创建 apps/hub-shell：Vite+React19+Router+Tailwind+shadcn；禁外链字体/脚本
    status: pending
  - id: pkg-ui-agent
    content: 创建 packages/hub-ui-kit、agent-client、workbench 骨架包
    status: pending
  - id: shell-auth-layout
    content: 实现登录页 + Auth/Tenant Provider + 基础 Shell 布局路由
    status: pending
  - id: facade-session-api
    content: hub-api：POST sessions/messages + GET events SSE + adapter/opencode 最小代理
    status: pending
  - id: workbench-stream
    content: workbench：本人会话列表/发消息/流式渲染（fetch-event-source）
    status: pending
  - id: intranet-runtime
    content: 文档化或 compose 附加内网 opencode serve / mock LLM baseUrl
    status: pending
  - id: dod-e2e-stream
    content: DoD：浏览器登录→开会话→收到流式事件；DevTools 无公网请求
    status: pending
isProject: false
---
# P0-03 SPA 与 Facade 会话联调

> **索引 todo**：`phase0-react-spa` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P0-02-domain-api.plan.md) · [目录](README.md)

> 产品上下文：[04-frontend](../04-frontend.plan.md) · [03-facade](../03-facade-isolation-instances.plan.md)

## 前置

- 上一本手册全部 todos 已完成且 DoD 通过（首本除外）。
- 必读 SoT：[04-Facade](../../../../docs/architecture/04-gateway-facade.md) · [10-Frontend](../../../../docs/architecture/10-frontend.md) · [11-Contract](../../../../docs/architecture/11-runtime-contract.md) · [17-Libs](../../../../docs/architecture/17-libraries.md)

## 目标

打通「浏览器 → Hub Facade → Runtime」最小流式路径；管理面完整页放到 P1。

## 落地步骤（与 todos 对应）

1. **scaffold-hub-shell**：Vite SPA；本地/自托管字体；ky + TanStack Query；路由占位。
2. **pkg-ui-agent**：`hub-ui-kit`（shadcn 组合）、`agent-client`（会话 REST/SSE）、`workbench` 导出可挂载组件。
3. **shell-auth-layout**：登录调 hub-api；httpOnly refresh 或约定的 JWT 存储策略按 03/10；顶栏占位。
4. **facade-session-api**：`POST /v1/projects/:id/sessions`、`POST .../messages`、`GET .../events`；`packages/adapter/opencode` 最小实现；阻断浏览器直打上游 session/event（04）。
5. **workbench-stream**：P0 仅流式对话骨架，文件树/权限弹窗可 P1。
6. **intranet-runtime**：compose 或 README 说明如何挂内网 `opencode serve` + mock LLM。
7. **dod-e2e-stream**：见下。

## 路径清单

```text
apps/hub-shell/
packages/{hub-ui-kit,agent-client,workbench,adapter/common,adapter/opencode}/
apps/hub-api/src/routes/sessions*.ts
```

## DoD 命令

```bash
pnpm dev   # hub-api + hub-shell
# 浏览器：登录 → 进入 workbench 路由 → 发消息 → 见 SSE delta
# 确认 Network 无公网 CDN/字体/LLM 直连
```

## 明确不做

- 不对齐 html 三组导航全页；不做看板/配置中心/公共文件。
- 不 vendor OpenCode Web；无 `/wb/*`。

