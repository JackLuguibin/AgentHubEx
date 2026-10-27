# P1 验收勾选（A1–A16、N1–N4）

记录日期：2026-10-26。对照 [13.4](../architecture/13-roadmap-acceptance.md) 与 [18.7](../architecture/18-intranet-offline.md)。

复跑：

```bash
pnpm test:integration
pnpm test:e2e
bash scripts/build-offline-bundle.sh
```

`test:integration` 是 Hub API 的集成测试（连本机 Postgres 和 Redis）。`test:e2e` 是前端的 Vitest 检查。仓库里没有 Playwright，所以没有浏览器点击脚本。

## 结果

| ID | 结论 | 依据 |
|---|---|---|
| A1 | 豁免，见跟踪 | 本环境没有另一台机器上的 opencode。数据库也没有 `session_messages` 表。建这张表要改 schema，本次按红线没有做。mock 流式会话仍由 `session-facade.test.ts` 覆盖。 |
| A2 | 通过 | `config-apply.test.ts`：发布含 Agent / MCP / Skill / AGENTS.md 的 Bundle，ApplyJob 为 succeeded。 |
| A3 | 通过 | 同一测试：回滚后受管文件恢复，用户自建 `notes.txt` 仍在。 |
| A4 | 通过 | `common-space.test.ts`：`docs/spec.md` 同步到工作区 `project-common/docs/spec.md`，对该目录写入被拒绝。 |
| A5 | 通过 | `board.test.ts`：三张卡分列计数正确；另一成员的看板 SSE 收到更新。 |
| A6 | 通过 | 同一测试：会话标题含 PROJ-1，Issue 进入 in_progress，关联可见。 |
| A7 | 通过 | `isolation.test.ts`：GET 个人凭据和项目凭据的 JSON 不含 secret。`no-secret-persistence.test.ts`：前端源码不使用 localStorage / sessionStorage / indexedDB。访问令牌只放在内存里。 |
| A8 | 通过 | `isolation.test.ts`：同租户其他成员访问他人 session、workspace sync、agent 反代，全部 404。 |
| A9 | 通过 | 同一测试：另一租户成员和无成员用户同样 404，并写下 `access.denied` 审计。审计目前进进程日志；`audit_logs` 表仍未建，这是原有设计，本次不改库。 |
| A10 | 通过 | `instance-proxy.test.ts`：`PUT /auth`、`PATCH /config`、`GET /event`、`POST /session` 返回 403 `BLOCKED_UPSTREAM_PATH`。 |
| A11 | 通过 | `isolation.test.ts`：移除成员后其会话变为 aborted，再访问工作区反代得到 404。 |
| A12 | 通过（代码审查） | 前端是一个 React SPA。Workbench 不直接 `fetch`。Shell 里仅有的 `fetch` 是刷新 Hub 登录，地址来自同源 `VITE_HUB_API_BASE`。会话走 Facade SSE。文件走 `/agent` 白名单。 |
| A13 | 通过 | 停用租户后，进行中会话 aborted；再开会话或发消息返回 409 `TENANT_SUSPENDED`；仍可切换到另一个未停用租户。 |
| A14 | 通过 | 归档后会话 aborted，再开会话或发消息返回 409 `PROJECT_ARCHIVED`。删除最后一名 project owner 返回 409。最后一名 tenant owner 的 409 由 `domain-api.test.ts` 覆盖。 |
| A15 | 通过 | 伪造过旧的 `Last-Event-ID` 时，SSE 首帧是 `SSE_CURSOR_STALE` 并关闭。游标仍在缓冲里时会补发后续事件。 |
| A16 | 通过 | 日 token 用量达到 `tokensPerDay` 后，新消息和新会话返回 429 `QUOTA_EXCEEDED`。已经打开的会话保持 active，不会被这次限额中止。 |
| N1 | 豁免，见跟踪 | `compose.intranet.yml` 没有公网 URL，这是静态检查。没有在本机拔掉公网再 `compose up` 全栈。 |
| N2 | 通过 | `intranet-bundle.test.ts` 扫描 Shell、Workbench、界面组件和 agent-client，没有 Google Fonts、unpkg、jsDelivr、cdnjs。 |
| N3 | 部分通过，见跟踪 | `isolation-policy.test.ts`：intranet / airgap 默认拒绝公网，放行 allowlist，并且始终拒绝云元数据地址。P1 还没有 Worker 容器，所以没有在容器里做 iptables 演练。项目 `allowedProviderHosts` 已在创建凭据和开会话时生效。 |
| N4 | 部分通过，见跟踪 | `scripts/build-offline-bundle.sh` 写出 dry-run 目录、迁移 SQL 和校验和，脚本本身不安装依赖、不拉取镜像。没有在一台没有 npm registry 的机器上做实机安装。 |

2026-10-26 本次执行：Hub API 13 个测试文件、28 条测试通过；Hub Shell 3 个测试文件、6 条测试通过。

## 跟踪

1. **A1 历史消息落库。** 要新增 `session_messages`（或等价表）并让 `GET /v1/sessions/{id}/messages` 只读这张表。这是数据库 schema 变更，需要你点头后才能做。在此之前，刷新页面不能保证历史来自 Hub。
2. **N1 断公网演练。** 在镜像已经在本机或私有仓库之后，断开公网，执行 `docker compose -f deploy/compose/compose.intranet.yml up -d`，再登录、打开看板、登记内网 opencode、开一次会话。
3. **N3 Worker 出网。** P2 有 Worker 容器之后，用 `EGRESS_ALLOWLIST` 套用 `workerEgressPolicy` 的结果：默认拒绝公网，放行名单内的内网 LLM，拒绝 `169.254.169.254` 和控制面网段。
4. **N4 实机安装。** 把 dry-run 目录加上镜像 tar 后，拷到没有 npm registry 的机器，按 [offline-bundle 手册](../../deploy/offline-bundle/README.md) 导入并升级。
