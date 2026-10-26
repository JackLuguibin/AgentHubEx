---
name: P1-04 配置 Apply
overview: 配置中心 Tabs/发布下发/回滚 + agenthub-sync。
todos:
  - id: pkg-config-bundle
    content: 实现 packages/config-bundle：合并优先级、渲染 opencode.json/文件树
    status: pending
  - id: bundle-api
    content: ConfigBundle draft/publish/pin/rollback + ApplyJob API
    status: pending
  - id: config-center-ui
    content: 配置中心 Tabs：Agent/MCP/Skill/AGENTS.md/下发记录
    status: pending
  - id: apply-engine
    content: Apply 引擎：解析→渲染→API/文件通道→校验
    status: pending
  - id: agenthub-sync
    content: apps/agenthub-sync sidecar：拉取 Bundle 落盘（external）
    status: pending
  - id: dod-apply
    content: DoD：发布后同步可见 Agent/MCP/Skill；回滚恢复受管文件（A2/A3）
    status: pending
isProject: false
---
# P1-04 配置中心与 Apply

> **索引 todo**：`phase1-config-apply` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P1-03-external-proxy.plan.md) · [目录](README.md)

> 产品上下文：[02-domain](../02-domain-collaboration.plan.md)

## 前置

- 上一本手册全部 todos 已完成且 DoD 通过。
- 必读 SoT：[07-Config](../../../../docs/architecture/07-config-bundle.md) · [16-API](../../../../docs/architecture/16-api-schema.md)

## 目标

门户为配置 SoT；external 经 agenthub-sync 落盘。

## 落地步骤（与 todos 对应）

1. **pkg-config-bundle**：Platform→Tenant→Project→User overlay 合并。
2. **bundle-api**：不可变版本；ApplyJob 状态。
3. **config-center-ui**：对齐原型 config。
4. **apply-engine**：secretRef 注入；失败告警。
5. **agenthub-sync**：签名 URL 拉 Bundle。
6. **dod-apply**：A2/A3。

## DoD 命令

```bash
pnpm --filter @agenthub/config-bundle test
# 发布 Bundle → Apply succeeded → 回滚上一 revision
```

## 明确不做

- 不做自动推送到全部在线实例的规模化调度（强化在 P2-02）。

