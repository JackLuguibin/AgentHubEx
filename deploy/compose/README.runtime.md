# Intranet runtime（P0-03）

## 默认：进程内 Mock（推荐本地联调）

`hub-api` 环境变量：

```bash
RUNTIME_MOCK=true
```

行为：

- 无可用 `runtime_instances` 时自动登记 `baseUrl=mock://opencode` 的 external 实例
- `@agenthub/adapter-opencode` 走内存 mock：创建会话、发消息、SSE `assistant.delta`
- **不访问公网 LLM / CDN**

联调：

```bash
docker compose -f deploy/compose/compose.intranet.yml up -d
pnpm install
pnpm db:migrate
pnpm seed
pnpm --filter @agenthub/hub-api dev
pnpm --filter @agenthub/hub-shell dev
# 浏览器 http://localhost:5173 → 登录 → Workbench → 新建会话 → 发消息
```

## 可选：挂真实内网 `opencode serve`

1. 在内网启动 `opencode serve`（或使用 `compose.runtime-mock.yml` 的私有镜像占位）。
2. 将 Provider / 模型 `baseUrl` 指向内网 mock LLM（禁止直连公网）。
3. 调用 Hub API 登记实例（`baseUrl` 指向该 serve）。
4. 设置 `RUNTIME_MOCK=false` 后重启 hub-api。

Adapter 会内网直连上游 `/session`、`/event`；浏览器只打 Hub Facade，永不直连节点。
