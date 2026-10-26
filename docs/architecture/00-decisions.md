# 00 架构决策记录（ADR）

记录已拍板的细节方案。后续变更请追加新条目，不要改写旧条目（标记 `Superseded by ADR-xxx`）。

| ADR | 主题 | 决策 | 状态 | 影响文档 |
|---|---|---|---|---|
| 001 | 登录方式 | 首版本地账号（邮箱+密码），预留 OIDC 接入；同一用户可绑定多个身份 | Accepted | [03](03-auth-rbac.md) |
| 002 | 容器隔离强度 | 普通 Docker（runc）+ 基础加固，**不引入 gVisor/Kata，不首版上 K8s** | Accepted | [05](05-runtime-instances.md), [12](12-security-observability-deployment.md) |
| 003 | Agent 出网策略 | **默认放开出网**，只做审计；不做域名白名单。仅禁止访问控制面网段与云元数据地址 | Accepted | [05](05-runtime-instances.md), [12](12-security-observability-deployment.md) |
| 004 | 主键 | UUIDv7，应用层生成 | Accepted | [02](02-domain-model.md), [15](15-database-ddl.md) |
| 005 | 工作区代码种子 | 每用户独立 clone（节点级 bare 镜像缓存加速），不共享 worktree | Accepted | [14](14-workspace-git.md) |
| 006 | Git 凭据 | 不落盘：容器内 credential helper 向 worker 内存取；来源为用户 PAT 或项目级 Git 凭据 | Accepted | [14](14-workspace-git.md) |
| 007 | API 约定 | REST + JSON，camelCase，游标分页，zod 作为 Schema 单一来源并导出 OpenAPI 3.1 | Accepted | [16](16-api-schema.md) |

## ADR-001 登录方式

- **背景**：首版需要快速可用，同时企业客户后续要接 SSO。
- **决策**：`users.password_hash` 可空；新增 `user_identities(provider, subject)` 表；OIDC 用标准 Authorization Code + PKCE；租户可配置 `allowedLoginMethods`（`password` / `oidc:<id>`）。
- **后果**：首版只需实现密码登录 + 邀请注册；OIDC 在 Phase 2 前按需打开，不影响 JWT 结构。

## ADR-002 容器隔离

- **背景**：要求“不要搞得太复杂”。
- **决策**：单节点 Docker；每工作区一个容器、一个卷；加固项只保留低成本且无兼容性问题的：非 root、`cap-drop ALL`、`no-new-privileges`、不挂 docker.sock、CPU/内存/pids 限制。**不做**只读根文件系统（避免 Agent 装依赖失败）、不做独立 bridge 网络（统一使用一个 `agenthub-ws` 网络 + 关闭容器间互通 `icc=false`）。
- **后果**：隔离强度足以防止误操作与普通越权，不防高级容器逃逸；如未来接入不可信外部用户，再评估 gVisor。

## ADR-003 出网策略

- **背景**：Agent 需要装依赖、访问文档、调用任意 MCP，白名单维护成本高。
- **决策**：默认放开。保留两条硬禁止（iptables `DOCKER-USER` 链）：
  1. 禁止访问 `169.254.169.254` 等云元数据地址；
  2. 禁止访问控制面内网段（PG/Redis/MinIO/hub-api 内部端口）。
- **审计**：Node 级记录 DNS 查询日志（可选 dnsmasq 日志），保留 7 天。
- **后果**：凭据保护更依赖 Phase 3 LLM Proxy（容器内无真实 Key）。
