---
name: P1-05 公共文件空间
overview: 公共文件树+保护前缀+同步 project-common。
todos:
  - id: pkg-common-fs
    content: packages/common-fs：路径安全、受保护前缀、S3 键规则
    status: pending
  - id: common-api
    content: 实现 /v1/projects/:id/common/files* 与 upload/sync-common API
    status: pending
  - id: files-ui
    content: 公共文件页：树/面包屑/上传/预览/保护前缀标记
    status: pending
  - id: sync-workspace
    content: 同步到工作区只读树 project-common/（managed 写卷或 sync）
    status: pending
  - id: rbac-prefixes
    content: viewer 只读；developer 写；保护前缀仅 owner
    status: pending
  - id: dod-common
    content: DoD：上传 docs/spec.md 同步后工作区可见；Agent 默认不可写公共区（A4）
    status: pending
isProject: false
---
# P1-05 项目公共空间

> **索引 todo**：`phase1-common-fs` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P1-04-config-apply.plan.md) · [目录](README.md)

> 产品上下文：[02-domain](../02-domain-collaboration.plan.md)

## 前置

- 上一本手册全部 todos 已完成且 DoD 通过。
- 必读 SoT：[08-Common](../../../../docs/architecture/08-common-space.md) · [16-API](../../../../docs/architecture/16-api-schema.md)

## 目标

与个人工作区分离；默认 `on_workspace_start` 同步。

## 落地步骤（与 todos 对应）

1. **pkg-common-fs**：禁 `..`；MIME/配额。
2. **common-api**：MinIO 后端。
3. **files-ui**：对齐原型 files。
4. **sync-workspace**：`POST .../sync-common`。
5. **rbac-prefixes**：项目设置受保护前缀。
6. **dod-common**：A4。

## DoD 命令

```bash
pnpm --filter @agenthub/common-fs test
# 上传 → sync → 检查 workspace/project-common/docs/spec.md
```

## 明确不做

- 实时协同编辑；ZIP 解压仅后端。

