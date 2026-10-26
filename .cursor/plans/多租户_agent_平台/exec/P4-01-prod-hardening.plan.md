---
name: P4-01 生产加固
overview: mTLS、KMS、OTel/告警、可选 K8s。
todos:
  - id: mtls-nodes
    content: Gateway↔Node Agent / sync mTLS
    status: pending
  - id: kms-secrets
    content: 凭据/节点密钥 KMS 或等价信封加密轮换
    status: pending
  - id: otel-alerts
    content: OpenTelemetry 指标/追踪 + 告警演练
    status: pending
  - id: optional-k8s
    content: 可选 K8s 清单（数据面仍可 Docker，ADR-002）
    status: pending
  - id: dod-prod
    content: DoD：渗透无高危；告警演练通过（13.3 P4）
    status: pending
isProject: false
---
# P4-01 生产加固

> **索引 todo**：`phase4-prod` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P3-02-llm-proxy.plan.md) · [目录](README.md)
>
> **粒度**：骨架手册——实现前须精读 SoT；可将本 todos 再拆子任务。

## 前置

- P1-08 DoD 已通过（或本阶段前序手册已完成）。
- 必读 SoT：[12-Sec](../../../../docs/architecture/12-security-observability-deployment.md) · [18-Intranet](../../../../docs/architecture/18-intranet-offline.md) · [13-Roadmap](../../../../docs/architecture/13-roadmap-acceptance.md)

## 目标

mTLS、KMS、OTel/告警、可选 K8s。

## 落地步骤（与 todos 对应）

1. **mtls-nodes**：见 architecture 指针与下方清单。
2. **kms-secrets**：见 architecture 指针与下方清单。
3. **otel-alerts**：见 architecture 指针与下方清单。
4. **optional-k8s**：见 architecture 指针与下方清单。
5. **dod-prod**：见 architecture 指针与下方清单。

## 实现清单

- RLS 预留评估
- 不放松一人一容器

## DoD

见 13.3 P4；安全与观测验收通过。

## 明确不做

- 不回退放宽 P1 隔离与凭据硬规则。

