# AgentHubEx

多租户双引擎 Agent 平台（Hub 控制面 + Facade + React SPA）。

## 简介

默认 **内网部署**（`DEPLOY_PROFILE=intranet`）：不依赖公网 CDN / npm / Docker Hub 运行时拉取。架构与执行手册见：

- [`docs/architecture/`](docs/architecture/README.md)
- [`.cursor/plans/多租户_agent_平台/exec/`](.cursor/plans/多租户_agent_平台/exec/README.md)

**前端约定**：禁止运行时外链字体/脚本（Google Fonts、unpkg、jsDelivr 等）；静态资源随 `hub-shell` 自托管。

## 快速开始（P0 骨架）

```bash
git clone https://github.com/JackLuguibin/AgentHubEx.git
cd AgentHubEx

# 基础设施（PostgreSQL 16 / Redis 7）
docker compose -f deploy/compose/compose.intranet.yml up -d

# 可选：对象存储 MinIO（需能拉取 bitnami/minio，或改指向私有 Registry）
# docker compose -f deploy/compose/compose.intranet.yml --profile object-storage up -d

cp .env.example .env
pnpm install
pnpm db:migrate
pnpm --filter @agenthub/auth test
```

| 服务 | 端口 |
|---|---|
| PostgreSQL | 5432 |
| Redis | 6379 |
| MinIO API / Console（`--profile object-storage`） | 9000 / 9001 |

## Monorepo

| 路径 | 包 |
|---|---|
| `packages/db` | Drizzle schema + 迁移 |
| `packages/auth` | JWT / argon2 / RBAC |
| `packages/domain` | zod 领域类型骨架 |
| `packages/runtime-contract` | Worker/Adapter 契约骨架 |

根脚本：`pnpm build` · `pnpm test` · `pnpm lint` · `pnpm db:migrate`

## License

待定。
