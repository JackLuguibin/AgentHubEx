# Offline Bundle 约定（内网 / 空气隔离）

> **SoT**：[docs/architecture/18-intranet-offline.md](../../docs/architecture/18-intranet-offline.md)（部署档位、验收 N1–N4、环境变量总表）  
> **验收手册**：[P1-08 隔离与验收](../../.cursor/plans/多租户_agent_平台/exec/P1-08-isolation-acceptance.plan.md)（含 **N4**：仅导入 bundle、无 npm registry）  
> **打包脚本（P1）**：[scripts/build-offline-bundle.sh](../../scripts/build-offline-bundle.sh)

本目录约定 **空气隔离安装介质** 的布局与导入步骤。P0 只落地文档与占位；完整打包 CI / 实机演练属 **P1-08 / N4**。

## 1. 目录布局

仓库内保留约定骨架（产物文件由打包脚本生成，勿提交真实镜像 tar）：

```text
deploy/offline-bundle/
├── README.md                 # 本约定
├── images/                   # 容器镜像 tar（docker save）
│   └── .gitkeep
├── npm/                      # 可选：pnpm store / fetch 缓存（仅构建机需要时）
│   └── .gitkeep
└── configs/                  # 随包配置副本（compose、示例 env、VERSION）
    └── .gitkeep
```

**交付介质（打包输出，可在仓库外或 CI artifact）建议完整树：**

```text
offline-bundle-<version>/
├── VERSION.txt               # Hub semver ↔ minAgentVersion ↔ 镜像 digest 矩阵
├── checksums.sha256
├── images/
│   ├── hub-api-<digest>.tar
│   ├── hub-jobs-<digest>.tar
│   ├── hub-shell-<digest>.tar   # 若静态资源打进 Nginx 镜像
│   ├── worker-opencode-<digest>.tar
│   ├── postgres-16-alpine.tar
│   ├── redis-7-alpine.tar
│   └── minio-<tag>.tar          # 若使用 object-storage profile
├── npm/                         # 可选；生产机不跑 pnpm install
│   └── store/                   # pnpm fetch 产物
├── configs/
│   ├── compose.intranet.yml     # 自 deploy/compose/ 拷贝；镜像名已改私有 Registry
│   ├── .env.intranet.example
│   └── registry-tags.txt        # 源镜像 → 私有 tag 对照
├── hub-shell-dist/              # 前端静态资源（自托管，无 CDN）
└── migrations/                  # Drizzle SQL / 迁移产物
```

对齐 [18.4](../../docs/architecture/18-intranet-offline.md)：生产机不访问 npmjs / Docker Hub；依赖打进镜像或私有 Registry。

## 2. 私有 Registry / 内网镜像导入

外网构建机完成 `docker build`（或拉取基础镜像）后，任选其一将镜像导入内网。

### 2.1 介质导入（推荐空气隔离）

在外网机构建并导出：

```bash
# 示例：导出基础依赖与应用镜像
docker pull postgres:16-alpine
docker pull redis:7-alpine
# docker build -t registry.example.local/agenthub/hub-api:<ver> ...
docker save -o images/postgres-16-alpine.tar postgres:16-alpine
docker save -o images/redis-7-alpine.tar redis:7-alpine
# docker save -o images/hub-api-<ver>.tar registry.example.local/agenthub/hub-api:<ver>
sha256sum images/*.tar > checksums.sha256
```

在内网机校验并加载，再推送到私有 Registry（Harbor / 其他 OCI）：

```bash
sha256sum -c checksums.sha256
docker load -i images/postgres-16-alpine.tar
docker load -i images/redis-7-alpine.tar
# docker load -i images/hub-api-<ver>.tar

# 打私有 tag 并推送（按客户 Harbor 项目调整）
export REGISTRY=registry.example.local/agenthub
docker tag postgres:16-alpine "$REGISTRY/postgres:16-alpine"
docker tag redis:7-alpine "$REGISTRY/redis:7-alpine"
docker push "$REGISTRY/postgres:16-alpine"
docker push "$REGISTRY/redis:7-alpine"
```

将 `configs/compose.intranet.yml` 中的 `image:` 改为 `$REGISTRY/...` 后：

```bash
docker compose -f configs/compose.intranet.yml up -d
# 应用镜像就绪后滚动 hub-api / hub-jobs / hub-shell；再 drizzle-kit migrate
```

### 2.2 中转 Registry（有跳板时）

外网机 `docker push` → 中转 Registry → 内网 Harbor 同步 / 拉取。运行时节点仍只允许访问客户私有 Registry，禁止运行时 `docker pull` 公网（见 [18.2](../../docs/architecture/18-intranet-offline.md)）。

### 2.3 npm / 私有 Registry（可选）

| 场景 | 做法 |
|---|---|
| 生产运行 | **不在生产机执行** `pnpm install`；依赖已在镜像内 |
| 内网构建机 | 使用 bundle 内 `npm/` 缓存：`pnpm fetch --offline` / 指向 Verdaccio 等私有 registry |
| 锁文件 | 始终携带根目录 `pnpm-lock.yaml`；禁止在线解析最新版本 |

Verdaccio 示例（内网构建机）：将 `npm/` 中 pack 或 cache 导入 Verdaccio storage，`.npmrc` 指向 `http://verdaccio.internal/`，再执行离线安装。完整自动化留给 P1 打包脚本。

## 3. `DEPLOY_PROFILE=intranet` 环境变量清单

开关与完整表以 [18.1 / 18.10](../../docs/architecture/18-intranet-offline.md) 为准。交付档位默认 **`DEPLOY_PROFILE=intranet`**（空气隔离用 `airgap`）。

| 变量 | 组件 | 必填 | 内网说明 |
|---|---|:-:|---|
| `DEPLOY_PROFILE` | 全体 | | `intranet`（默认）\| `airgap` \| `internet-lab` |
| `DATABASE_URL` | hub-api / jobs | ✓ | 内网 PG（compose 或客户库） |
| `REDIS_URL` | hub-api / jobs | ✓ | 内网 Redis |
| `S3_ENDPOINT` | hub-api / jobs | ✓ | 内网 MinIO / S3 兼容 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` | hub-api / jobs | ✓ | 勿提交真实密钥 |
| `AGENTHUB_MASTER_KEY` | hub-api / jobs | ✓ | KEK；见 18.10 |
| `AGENTHUB_JWT_KEYS` | hub-api | ✓ | JWKS / PEM |
| `AGENTHUB_PUBLIC_URL` | hub-api | ✓ | 内网入口 URL |
| `AGENTHUB_CORS_ORIGINS` | hub-api | ✓ | 逗号分隔；仅内网前端源 |
| `AGENTHUB_BOOTSTRAP_ADMIN_EMAIL` | hub-api | | 首次初始化 |
| `CONTROL_PLANE_CIDR` | node-agent | ✓（数据面） | 出网拒绝控制面 |
| `EGRESS_ALLOWLIST` | node-agent | intranet | 内网 LLM / Git 等 CIDR |
| `VITE_HUB_API_BASE` | hub-shell **构建时** | | 空 = 同域；打进 dist |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 可选 | | 空 = 禁用；指向内网 Collector |

开发用示例见仓库根 [`.env.example`](../../.env.example)（含 `JWT_*` / `PLATFORM_DEK` 等 P0 字段）；生产密钥用编排 secret，**离线包不含 demo 密钥**（[18.8](../../docs/architecture/18-intranet-offline.md)）。

LLM：凭据 `baseUrl` 指向内网网关 / vLLM / Ollama；勿写死公网 `api.openai.com`。

## 4. 无 CDN / 无公网硬依赖检查清单

供前端评审与 CI 静态检查（允许列表除外）。对齐 [18.2](../../docs/architecture/18-intranet-offline.md)、[18.6](../../docs/architecture/18-intranet-offline.md)、[18.8](../../docs/architecture/18-intranet-offline.md)。

### 前端（hub-shell / workbench / hub-ui-kit）

- [ ] 无运行时请求 Google Fonts / Adobe Fonts / 其他字体 CDN
- [ ] 无 `unpkg.com` / `jsDelivr` / `cdnjs` / `esm.sh` 等脚本或模块外链
- [ ] 无在 HTML 中注入第三方 analytics / 遥测脚本（默认关闭对外心跳，见 18.6）
- [ ] 非系统字体须 **自托管** 并打进 `hub-shell-dist`
- [ ] `VITE_HUB_API_BASE` 默认同源；DevTools 无对公网域名的请求（验收 **N2**）

### 镜像与 Compose

- [ ] 交付用 compose **不**在运行时依赖 Docker Hub 拉取；`image:` 指向私有 Registry 或已 `docker load` 的本地 tag
- [ ] 基础镜像（postgres / redis / minio / node / worker）已列入 `images/` 或 Harbor
- [ ] OpenCode / worker 基础镜像已预拉并重打 tag（18.4）

### 构建与发布

- [ ] 生产机不执行在线 `pnpm install` / `npm update`
- [ ] 锁文件 `pnpm-lock.yaml` 随源码或 bundle 提供
- [ ] 升级路径：导入新 bundle → migrate → 滚动镜像（18.9）；不要求在线拉包

## 5. 打包脚本状态（P1）

| 项 | 状态 |
|---|---|
| `scripts/build-offline-bundle.sh` | **P1 占位**：路径与出口约定已固定，实现待 P1-08 / N4 |
| 完整 offline 打包 CI | **不做于 P0**（见执行手册「明确不做」） |
| N4 实机「仅导入 bundle」演练 | **P1-08** |

占位脚本用法：

```bash
./scripts/build-offline-bundle.sh
# 预期：打印目标目录约定并 exit 0；不产生完整产物
```

## 6. 与验收的交叉引用

| 验收 ID | 期望 | 本约定落点 |
|---|---|---|
| N1 | 断公网 `compose up` 全栈可用 | `configs/compose.intranet.yml` + §3 变量 |
| N2 | 浏览器无公网请求 | §4 前端清单 |
| N3 | Worker 仅 allowlist | `EGRESS_ALLOWLIST` / 18.3 |
| N4 | 仅导入 bundle（无 npm registry）安装升级 | §1 目录 + §2 导入 + [P1-08](../../.cursor/plans/多租户_agent_平台/exec/P1-08-isolation-acceptance.plan.md) |

升级 / 回滚步骤见 [18.9](../../docs/architecture/18-intranet-offline.md)。
