---
name: P0-04 Offline 约定
overview: 记录 offline-bundle 目录、私有 Registry 导入与 DEPLOY_PROFILE；脚本可标 P1。
todos:
  - id: offline-bundle-layout
    content: 在 deploy/ 或 docs 写明 offline-bundle 目录约定（镜像/npm/配置）
    status: completed
  - id: registry-import-steps
    content: 文档化私有 Registry / 内网镜像导入步骤（对齐 18）
    status: completed
  - id: env-profile-matrix
    content: 整理 DEPLOY_PROFILE=intranet 环境变量清单表（引用 18）
    status: completed
  - id: no-cdn-checklist
    content: 添加静态检查清单：禁外链字体/脚本/Docker Hub 硬依赖说明
    status: completed
  - id: p1-script-placeholder
    content: 标注打包脚本为 P1：路径占位 + 验收引用 N4
    status: completed
  - id: dod-docs-linked
    content: DoD：P1-08/N4 可从本约定链接到具体目录与变量表
    status: completed
isProject: false
---

# P0-04 离线 / 内网约定文档

> **索引 todo**：`phase0-offline-notes` · **父索引**：[多租户_agent_平台_c205364b.plan.md](../../多租户_agent_平台_c205364b.plan.md)
>
> **执行导航**：[上一本](P0-03-spa-facade-session.plan.md) · [目录](README.md)

> 产品上下文：[06-security-delivery](../06-security-delivery.plan.md)

## 前置

- 上一本手册全部 todos 已完成且 DoD 通过（首本除外）。
- 必读 SoT：[18-Intranet](../../../../docs/architecture/18-intranet-offline.md) · [12-Security](../../../../docs/architecture/12-security-observability-deployment.md)

## 目标

把空气隔离安装约定写进仓库，便于 P1 验收 N1–N4；不要求本步完成打包脚本。

## 落地步骤（与 todos 对应）

1. **offline-bundle-layout**：例如 `deploy/offline-bundle/{images,npm,configs,README.md}` 目录树说明。
2. **registry-import-steps**：从 18 摘录并落到仓库可执行的步骤列表（load 镜像、verdaccio/npm 等任选其一写清）。
3. **env-profile-matrix**：`DEPLOY_PROFILE`、DB/Redis/MinIO/LLM baseUrl 等变量表。
4. **no-cdn-checklist**：给前端/CI 用的检查项。
5. **p1-script-placeholder**：`scripts/build-offline-bundle.sh` 可先 echo 占位 + TODO。
6. **dod-docs-linked**：交叉链接到 18.7 与 P1-08。

## 路径清单

```text
deploy/offline-bundle/README.md
docs/architecture/18-intranet-offline.md   # 仅补链接，不重写正文
scripts/build-offline-bundle.sh            # 可选占位
```

## DoD 命令

```bash
test -f deploy/offline-bundle/README.md
rg -n "DEPLOY_PROFILE|offline-bundle" deploy/ docs/architecture/18-intranet-offline.md
```

## 明确不做

- 不实现完整 offline 打包 CI；不强制空气隔离实机演练（属 P1-08/N4）。

