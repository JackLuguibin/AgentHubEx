---
name: P2-01 Node Agent
overview: Node Agent managed 编排、多节点调度、idle/配额、credentialPolicy。
todos:
  - id: apps-node-agent
    content: 实现 apps/node-agent：dockerode 拉起 worker 容器 + mTLS 内网 API
    status: pending
  - id: scheduler
    content: Hub 调度：标签/容量/粘性/最少负载；写入 RuntimeInstance(mode=managed)
    status: pending
  - id: idle-quota
    content: idle TTL 停容器；每用户/项目配额与 credentialPolicy 强制
    status: pending
  - id: dod-managed
    content: DoD：managed 工作区 p95 就绪 < 120s（见 13.3）
    status: pending
isProject: false
---
# P2-01 Node Agent

> **索引 todo**：`phase2-node-agent` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P1-08-isolation-acceptance.plan.md) · [目录](README.md)
>
> **粒度**：骨架手册——实现前须精读 SoT；可将本 todos 再拆子任务。

## 前置

- P1-08 DoD 已通过（或本阶段前序手册已完成）。
- 必读 SoT：[05-Runtime](../../../../docs/architecture/05-runtime-instances.md) · [12-Sec](../../../../docs/architecture/12-security-observability-deployment.md) · [13-Roadmap](../../../../docs/architecture/13-roadmap-acceptance.md)

## 目标

Node Agent managed 编排、多节点调度、idle/配额、credentialPolicy。

## 落地步骤（与 todos 对应）

1. **apps-node-agent**：见 architecture 指针与下方清单。
2. **scheduler**：见 architecture 指针与下方清单。
3. **idle-quota**：见 architecture 指针与下方清单。
4. **dod-managed**：见 architecture 指针与下方清单。

## 实现清单

- `POST /workspaces` 等 Node Agent API（主题 plan 03）
- 镜像 agenthub/worker-opencode
- 禁止业务容器挂载 docker.sock

## DoD

见 [13.3](../../../../docs/architecture/13-roadmap-acceptance.md) P2 行；手工创建 managed 工作区并开会话。

## 明确不做

- 不回退放宽 P1 隔离与凭据硬规则。

