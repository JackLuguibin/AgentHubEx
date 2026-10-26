# 18 内网 / 离线部署（首要交付形态）

产品默认在**客户内网**运行，不依赖公网。可进一步做到**断网空气隔离**（构建与镜像由外网机导入）。见 ADR-011。

## 18.1 部署档位

| 档位 | 含义 | 首版目标 |
|---|---|---|
| **intranet** | 用户浏览器、Hub、Worker、Git、模型服务均在内网；无公网出口或严格代理 | **默认** |
| **airgap** | 运行环境完全无外网；安装包 / 镜像 / npm 缓存事先导入私有仓库 | P1 可安装；运维手册必备 |
| internet-lab | 开发机可访问公网（仅研发） | 本地开发可选 |

**SoT 开关**：环境变量 `DEPLOY_PROFILE=intranet|airgap|internet-lab`（默认 `intranet`）。  
Compose：`deploy/compose/compose.intranet.yml` 为交付基线；`compose.override.yml` 仅开发机覆盖为 `internet-lab`。  
node-agent / worker 网络策略读取同一变量（见 [05 §5.8](05-runtime-instances.md)）。

## 18.2 运行时依赖（全部可内网化）

| 依赖 | 内网落点 | 禁止 |
|---|---|---|
| 前端静态资源 | 同域 Nginx/Caddy 托管 `hub-shell` dist | 运行时拉 Google Fonts / unpkg / jsDelivr |
| Hub API / PG / Redis / MinIO | compose 或内网虚拟机 | 托管云 SaaS 为必需项 |
| 容器镜像 | 客户 **私有 Registry**（Harbor 等） | 运行时 `docker pull` 公网 |
| LLM | 凭据 `baseUrl` 指向内网网关 / vLLM / Ollama / 厂商专线；或 P3 Hub LLM Proxy | 写死仅 `api.openai.com` 等公网 |
| Git | 内网 GitLab / Gitea / GitHub Enterprise | 强制 github.com |
| OIDC（可选） | 仅内网 IdP；首版以本地账号为主（ADR-001） | 依赖公网 IdP 才能登录 |
| 可观测 | 内网 OTel Collector + 自建日志/Prometheus | 强制 Datadog/云监控才能跑 |
| 证书 | 内网 CA / 自签；支持自定义信任链 | 必须 Let's Encrypt 公网签发 |

## 18.3 Agent 出网（覆盖 ADR-003 在内网档）

| 档位 | 策略 |
|---|---|
| **intranet / airgap** | **默认拒绝**工作区容器访问公网；仅放行运维配置的 **allowlist**（内网 LLM baseUrl、内网 Git、必要 APT/PyPI 镜像若有） |
| internet-lab | 仍按 ADR-003：默认放开 + 禁控制面/元数据 |

控制面网段与云元数据地址在所有档位均禁止。DNS 审计在内网档仍建议开启。

## 18.4 构建与交付（离线包）

```text
外网构建机                          内网
─────────────────                   ─────────────────
pnpm fetch / 锁文件安装
docker build 各镜像
  → 导出 tar 或推到中转 Registry
打包 offline-bundle/
  images/*.tar
  hub-shell-dist/
  migrations/
  compose.intranet.yml
  checksums + 版本说明
        │
        └── 介质 / 跳板 ──► 私有 Registry 导入
                            docker load / harbor push
                            pnpm 不在生产机执行安装（镜像内已含）
```

约定：

- **生产机不访问 npmjs / Docker Hub**；依赖打进镜像或私有 registry。
- `pnpm-lock.yaml` 锁定；离线可用 `pnpm fetch` + 缓存目录随 bundle 提供（仅构建机需要时）。
- 前端构建：**自托管字体**（若用非系统字体），Tailwind/shadcn 无运行时 CDN。
- OpenCode / worker 基础镜像预拉并重打 tag 到私有仓库。

## 18.5 模型与凭据（内网）

- Provider 表单已有 **Base URL / 自定义 Header**（见凭据原型）：内网 OpenAI 兼容端点为首选。
- 项目可配置 `allowedProviderHosts`（可选）：创建/更新凭据时校验 `baseUrl` 主机名落在允许列表（防误填公网）。
- airgap 下无外网 Key 时：仅登记内网推理服务凭据；文档标明「无内网模型则无法开会话」。

## 18.6 前端与更新

- `VITE_HUB_API_BASE` 默认同源；无外链脚本。
- 版本升级：导入新 offline-bundle → 滚动替换镜像 → `drizzle-kit migrate`；不要求在线 `pnpm update`。
- 许可证/遥测：**默认关闭**任何对外心跳；若将来有更新检查须可关且默认关。

## 18.7 验收（内网档）

| ID | 场景 | 期望 |
|---|---|---|
| N1 | 断开公网后 `compose up` 全栈 | Hub 登录、看板、登记内网 opencode、开会话成功 |
| N2 | 浏览器 DevTools | 无对公网域名的请求 |
| N3 | Worker 容器 | 无法访问公网 IP；可访问 allowlist 内 LLM |
| N4 | 仅导入 bundle（无 npm registry） | 按手册完成安装升级 |

## 18.8 与开发档差异

开发者可在 internet-lab 使用公网模型与镜像以加速；**合并/发布产物必须能在 intranet 档验证 N1–N4**。CI 增加「禁止前端引入外链 URL」的静态检查（允许列表除外）。
