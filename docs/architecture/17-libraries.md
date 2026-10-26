# 17 公开开源组件 / 库选型（少造轮子）

原则（ADR-010）：

1. **公开开源**：源码或官方发行公开可获取；许可优先 MIT / Apache-2.0 / BSD / ISC / MPL-2.0。  
2. **成熟流行**：社区广泛使用、维护活跃、TypeScript 友好。  
3. **可自托管 / 可离线**：不绑定必须公网的专有 SaaS（配合 ADR-011）。  
4. **能复用不自研**：自研仅限领域组合（Facade、adapter、Workbench 壳、Bundle 语义）。

下表均为公开项目；引入新库须可说清仓库地址与许可证。

## 17.1 前端（`apps/hub-shell` + `packages/*`）

| 职责 | 选用 | 不自研 |
|---|---|---|
| 框架 / 构建 | React 19、Vite、TypeScript | — |
| 路由 | `react-router` (v7) | 自研路由器 |
| UI  primitive | **shadcn/ui**（Radix）+ Tailwind CSS 4/3 | 私有 Design System |
| 图标 | `lucide-react` | 自定义图标集 |
| 服务端状态 | `@tanstack/react-query` | 自研 cache |
| 表格 | `@tanstack/react-table` | — |
| 表单 | `react-hook-form` + `@hookform/resolvers/zod` | — |
| 拖拽看板 | `@dnd-kit/core` + sortable | 自研 DnD |
| ⌘K 搜索 | `cmdk`（shadcn Command） | — |
| Toast | `sonner` | — |
| HTTP | `ky`（credentials / hooks） | 裸 fetch 散落 |
| SSE | `@microsoft/fetch-event-source` | 自研 EventSource 封装 |
| Markdown 渲染 | `react-markdown` + `remark-gfm` + `rehype-sanitize` | 自研 md |
| 代码高亮 | `shiki`（或 `highlight.js`） | — |
| 日期 | `date-fns` | — |
| 校验 | `zod`（与后端同 schema） | — |
| 虚拟列表（长会话） | `@tanstack/react-virtual` | — |
| P2 编辑器 | `@monaco-editor/react` 或 CodeMirror 6（`@uiw/react-codemirror`） | 自研编辑器 |
| 测试 | Vitest、Testing Library、MSW、Playwright | — |

Workbench（`packages/workbench`）是**业务组合**，底层渲染/流式/表单全部用上表库。

## 17.2 后端 API（`apps/hub-api`）

| 职责 | 选用 | 不自研 |
|---|---|---|
| HTTP 框架 | **Hono** + `@hono/node-server` | Express 二开框架 |
| OpenAPI / 校验 | `@hono/zod-openapi` + **zod** | 手写校验器 |
| ORM | **Drizzle** + `postgres`（postgres.js）+ `drizzle-kit` | 裸 SQL（ADR-009） |
| 队列 | **BullMQ** + Redis（`ioredis`） | 自研 job 表轮询 |
| 队列看板（可选） | `@bull-board/api` + Hono adapter | — |
| JWT | `jose`（或 `hono/jwt`） | 自实现 JWT |
| 密码 / API Key 哈希 | `@node-rs/argon2` | 自实现哈希 |
| 限流 | `rate-limiter-flexible`（Redis） | 自研令牌桶 |
| 日志 | **pino** + `pino-http` | `console.log` 体系 |
| 观测 | OpenTelemetry JS（`@opentelemetry/sdk-*` + OTLP） | 自研 tracing |
| 对象存储 | `@aws-sdk/client-s3`（MinIO 兼容） | 自研 S3 客户端 |
| UUID | `uuid` v7 或 `uuidv7` | — |
| 环境变量 | `@t3-oss/env-core` + zod | 无校验 process.env |
| 上游 HTTP | 原生 `fetch` / `undici` | — |
| ZIP 解压 | `yauzl` 或 `unzipper`（流式 + 限额） | 自研 zip |
| Git 平台 API | `octokit`（GitHub）；GitLab 用官方/`@gitbeaker` | 手写 REST 拼装 |

RBAC / 多租户中间件为**领域逻辑**（薄封装），加密、队列、ORM、限流不重复发明。

## 17.3 Node Agent / Sync / Worker

| 职责 | 选用 |
|---|---|
| 容器编排 | **dockerode** |
| HTTP | Hono（与 hub-api 同风格） |
| 配置文件写盘 | Node `fs/promises` + 路径库 `pathe`；校验用 zod |
| Claude 引擎 | 官方 **Claude Agent SDK**（`@anthropic-ai/claude-agent-sdk` 或当时文档包名） |
| OpenCode | 上游 `opencode` 二进制 / serve（不 fork 内核） |

## 17.4 基础设施（compose）

| 职责 | 选用 |
|---|---|
| DB | PostgreSQL 16 官方镜像 |
| 缓存/队列/SSE 扇出 | Redis 7 |
| 对象存储 | MinIO |
| 反向代理（生产） | Nginx 或 Caddy（静态 SPA + `/v1` 反代） |

## 17.5 基础设施（均为公开发行）

| 组件 | 公开项目 | 典型许可 |
|---|---|---|
| 数据库 | PostgreSQL | PostgreSQL License |
| 缓存/队列代理 | Redis | RSALv2 / 或使用 Valkey（BSD）若客户要求 |
| 对象存储 | MinIO | AGPL-3.0（可自托管；接受其条款） |
| 反向代理 | Nginx (BSD-like) 或 Caddy (Apache-2.0) | |
| 容器 | Docker Engine / containerd | Apache-2.0 等 |
| 编排（可选） | 官方 Compose；P4 可选 K8s | |

若客户不允许 AGPL：对象存储可改为 **Garage** / **SeaweedFS** 等其它 OSI 许可的 S3 兼容实现（另 ADR），API 仍用 `@aws-sdk/client-s3`。

## 17.6 明确不引入（除非新 ADR）

| 候选 | 原因 |
|---|---|
| 闭源商业中间件 / 必须联网激活的专有 SDK | 违反公开开源与内网交付 |
| 以 SaaS 为唯一后端的 BaaS（强制外网） | ADR-011 |
| Next.js / Remix | 门户无 SEO；已定 Vite SPA（ADR-008） |
| Prisma | 已定 Drizzle（ADR-009）；不双 ORM |
| Redux / MobX | TanStack Query 已覆盖 |
| Socket.IO | SSE + 可选原生 WS 足够 |
| 自研 DS / 队列 / ORM / JWT | 少造轮子 |

## 17.7 新增依赖检查清单

合并前自问：

1. **是否公开开源**？仓库/发行页与 **SPDX 许可证**是否已记录？  
2. npm/GitHub 是否活跃维护（近 12 个月有 release）？  
3. 是否已有同类且已在本表？优先扩展已选库。  
4. 安全审计 / 供应链（lockfile）是否可接受？  
5. 是否可用 20 行业务代码 + 现有库替代？  
6. **内网友好**（ADR-011）：无公网 CDN、无强制电话回家？  

## 17.8 许可证与供应链（交付）

- 仓库维护根级 `NOTICE`（第三方归属）；新增依赖更新 NOTICE。  
- CI 建议：`license-checker` / `pnpm licenses` 对照允许列表（MIT/Apache-2.0/BSD/ISC/MPL-2.0 等）；AGPL（如 MinIO）须在客户交付说明中单列，不允许则换 Garage/SeaweedFS（另 ADR）。  
- 发布 offline-bundle 时附 SBOM（CycloneDX 或 SPDX JSON）可选；intranet 不强制联网扫描。  
