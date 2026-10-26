---
name: P3-02 LLM Proxy
overview: LLM Proxy 与按凭据来源计量。
todos:
  - id: llm-proxy
    content: Hub LLM Proxy：短时上游 token；Runtime 不持真实 Key
    status: pending
  - id: usage-by-source
    content: usage 记录 credentialSource/credentialId/userId/projectId
    status: pending
  - id: dod-no-key-in-container
    content: DoD：容器内无 Provider Key；计量可区分个人/项目
    status: pending
isProject: false
---
# P3-02 LLM Proxy

> **索引 todo**：`phase3-llm-proxy` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P3-01-worker-claude.plan.md) · [目录](README.md)
>
> **粒度**：骨架手册——实现前须精读 SoT；可将本 todos 再拆子任务。

## 前置

- P1-08 DoD 已通过（或本阶段前序手册已完成）。
- 必读 SoT：[06-Creds](../../../../docs/architecture/06-credentials.md) · [12-Sec](../../../../docs/architecture/12-security-observability-deployment.md)

## 目标

LLM Proxy 与按凭据来源计量。

## 落地步骤（与 todos 对应）

1. **llm-proxy**：见 architecture 指针与下方清单。
2. **usage-by-source**：见 architecture 指针与下方清单。
3. **dod-no-key-in-container**：见 architecture 指针与下方清单。

## 实现清单

- 轮换与会话快照策略与 06 一致

## DoD

见 13.3 P3 LLM Proxy 行。

## 明确不做

- 不回退放宽 P1 隔离与凭据硬规则。

