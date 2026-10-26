# 00 架构决策记录（ADR）

记录已拍板的细节方案。后续变更请追加新条目，不要改写旧条目（标记 `Superseded by ADR-xxx`）。

| ADR | 主题 | 决策 | 状态 | 影响文档 |
|---|---|---|---|---|
| 001 | 登录方式 | 首版本地账号（邮箱+密码），预留 OIDC 接入；同一用户可绑定多个身份 | Accepted | [03](03-auth-rbac.md) |
| 002 | 容器隔离强度 | 普通 Docker（runc）+ 基础加固，**不引入 gVisor/Kata，不首版上 K8s** | Accepted | [05](05-runtime-instances.md), [12](12-security-observability-deployment.md) |
| 003 | Agent 出网策略 | 研发档可放开；**intranet/airgap 默认拒绝公网 + allowlist**；禁控制面/元数据 | Accepted | [18](18-intranet-offline.md), [12](12-security-observability-deployment.md) |
| 004 | 主键 | UUIDv7，应用层生成 | Accepted | [02](02-domain-model.md), [15](15-database-ddl.md) |
| 005 | 工作区代码种子 | 每用户独立 clone（节点级 bare 镜像缓存加速），不共享 worktree | Accepted | [14](14-workspace-git.md) |
| 006 | Git 凭据 | 不落盘：容器内 credential helper 向 worker 内存取；来源为用户 PAT 或项目级 Git 凭据 | Accepted | [14](14-workspace-git.md) |
| 007 | API 约定 | REST + JSON，camelCase，游标分页，zod 作为 Schema 单一来源并导出 OpenAPI 3.1 | Accepted | [16](16-api-schema.md) |
| 008 | 前端形态 | 全站 React 单 SPA（Vite）；会话走 Facade SSE；文件/PTY 走 agent 反代；不 vendor OpenCode Web | Accepted | [10](10-frontend.md), [04](04-gateway-facade.md) |
| 009 | 数据访问 | **Drizzle ORM**；schema/迁移为 SoT；业务代码禁止手写 SQL 字符串 | Accepted | [15](15-database-ddl.md), [02](02-domain-model.md) |
| 010 | 依赖策略 | **公开开源优先**（OSI 许可、可 npm/镜像获取）；成熟流行；自研仅领域组合；见 [17](17-libraries.md) | Accepted | [17](17-libraries.md) |
| 011 | 部署网络 | **内网优先 / 可空气隔离**；默认交付档 intranet；详见 [18](18-intranet-offline.md) | Accepted | [18](18-intranet-offline.md), [12](12-security-observability-deployment.md) |
| 012 | 工作区基数 | `Project × User × RuntimeType → Workspace`（双引擎可两套） | Accepted | [02](02-domain-model.md), [05](05-runtime-instances.md), [15](15-database-ddl.md) |
| 013 | external 绑定 | 不强制 `boundUserId`；用 `isolation` + `assignedProjectIds`；`shared` 仅演示 | Accepted | [05](05-runtime-instances.md), [16](16-api-schema.md) |
| 014 | tenant.admin / 角色名 | 管理面 ≡ project.owner；平台角色统一 `platform.admin` | Accepted | [03](03-auth-rbac.md) |

## ADR-001 登录方式

- **背景**：首版需要快速可用，同时企业客户后续要接 SSO。
- **决策**：`users.password_hash` 可空；新增 `user_identities(provider, subject)` 表；OIDC 用标准 Authorization Code + PKCE；租户可配置 `allowedLoginMethods`（`password` / `oidc:<id>`）。
- **后果**：首版只需实现密码登录 + 邀请注册；OIDC 在 Phase 2 前按需打开，不影响 JWT 结构。

## ADR-002 容器隔离

- **背景**：要求“不要搞得太复杂”。
- **决策**：单节点 Docker；每工作区一个容器、一个卷；加固项只保留低成本且无兼容性问题的：非 root、`cap-drop ALL`、`no-new-privileges`、不挂 docker.sock、CPU/内存/pids 限制。**不做**只读根文件系统（避免 Agent 装依赖失败）、不做独立 bridge 网络（统一使用一个 `agenthub-ws` 网络 + 关闭容器间互通 `icc=false`）。
- **后果**：隔离强度足以防止误操作与普通越权，不防高级容器逃逸；如未来接入不可信外部用户，再评估 gVisor。

## ADR-003 出网策略

- **背景**：Agent 需要装依赖、访问文档、调用 MCP；同时产品以**内网部署**为主（ADR-011）。
- **决策**（按部署档）：
  - **internet-lab（仅研发）**：默认放开出网；硬禁止云元数据与控制面网段。
  - **intranet / airgap（默认交付）**：**默认拒绝公网**；仅放行运维配置的 allowlist（内网 LLM、内网 Git、可选内网 PyPI/APT 镜像）。控制面网段与元数据地址仍禁止。
- **审计**：Node 级 DNS 日志建议开启，保留 7 天。
- **后果**：内网档必须先备好内网模型与 Git；详见 [18](18-intranet-offline.md)。

## ADR-008 前端形态与客户端通道

- **背景**：需主流 React 栈；OpenCode Web 为 Solid，异栈 iframe 成本高；会话事件与文件访问需求不同。
- **决策**：
  1. **全站 React 单 SPA**（Vite + React Router + shadcn + TanStack）；不引入 Next.js/RSC；不 vendor OpenCode `packages/app`。
  2. **会话主路径 = Facade**：CRUD / messages / permissions / SSE 仅用 `/v1/projects/{p}/sessions` 与 `/v1/sessions/{id}/*`。
  3. **文件与 PTY = agent 反代**：仅 `/v1/workspaces/{w}/agent/{file,find,pty,...}` 白名单；浏览器**禁止**经反代打 `/event`、`POST /session`（由 Gateway→adapter 内网完成）。
  4. **路由**：工作台为 `/p/:projectId/workbench?session=`（UUID）；无独立 `/wb/*`。
  5. **Capabilities**：嵌在 `Workspace.capabilities`（见 [16](16-api-schema.md)）；无独立发现端点。
- **后果**：`packages/workbench` + `agent-client` 边界清晰；双引擎差异收敛在 adapter / `runtime-contract`。

## ADR-009 数据访问（Drizzle ORM）

- **背景**：避免业务层散落 SQL 字符串导致租户过滤遗漏、迁移与代码漂移；团队约定用类型化查询。
- **决策**：
  1. **ORM = Drizzle**（`drizzle-orm` + `drizzle-kit`）；驱动 `postgres.js` 或 `node-postgres`，统一经 `packages/db`。
  2. **Schema SoT**：`packages/db/schema/*.ts`；迁移只由 `drizzle-kit generate` 产出并人工审阅后应用，禁止「只改库不改 schema」。
  3. **访问路径**：`hub-api` / jobs 只通过 Repository（或等价模块）调用 Drizzle query builder / `db.insert|update|delete|select`；**禁止** `sql\`...\`` 拼接业务 SQL、禁止裸 `pg.query`。
  4. **例外（须 code review 标注 `// drizzle-raw: <理由>`）**：分区维护、一次性运维脚本、经评审的复杂报表；仍须参数绑定，且租户条件不得省略。
  5. [15-database-ddl.md](15-database-ddl.md) 中的 SQL 仅为**可读对照**，与 schema 冲突时以 TypeScript schema 为准并回写文档。
- **后果**：DDL 文档不再充当权威；CI 可对 `sql\` 与 `.query(` 做 lint 门禁（允许列表除外）。

## ADR-010 依赖与少造轮子（公开开源）

- **背景**：多租户 Agent 平台领域逻辑重；内网交付要求技术栈可审计、可自托管、可离线镜像化。
- **决策**：
  1. **公开开源优先**：运行时与构建依赖须为公开可获取的开源项目（GitHub/npm/Docker Hub 等有源码或官方发行），许可证优先 **MIT / Apache-2.0 / BSD / ISC / MPL-2.0** 等 OSI 认可许可；入库前记录 NOTICE。
  2. **禁止**将闭源商业 SDK、必须联网授权的专有中间件、不可自托管的 SaaS 客户端作为**运行时硬依赖**（内网档无法满足）。
  3. 栈锁定见 [17-libraries.md](17-libraries.md)（React/shadcn/TanStack、Hono、Drizzle、BullMQ、jose、argon2、pino、OTel、PostgreSQL、Redis、MinIO、Nginx/Caddy 等均为公开项目）。
  4. 自研仅限：Hub Facade/RBAC 编排、runtime adapter、Workbench 业务布局、ConfigBundle 合并语义。
  5. 引擎侧：OpenCode、Claude Agent SDK 等以其**公开文档/发行渠道**接入；不引入无源码、不可离线分发的专有 Agent 运行时。
- **后果**：PR 对照 [17.7](17-libraries.md)；专有/闭源硬依赖驳回；许可证不合规驳回。

## ADR-011 内网 / 离线部署

- **背景**：软件在客户内网使用，常无稳定公网或完全隔离。
- **决策**：
  1. **默认部署档 = intranet**；支持 airgap 离线包导入（镜像 + 静态资源 + migrate）。
  2. 运行时**不依赖**公网 CDN、公有 npm/Docker Hub、公有 IdP、公有可观测 SaaS。
  3. LLM / Git 经凭据与项目配置指向**内网服务**；可选 `allowedProviderHosts`。
  4. 前端资源全部自托管；默认关闭对外遥测/升级检查。
  5. Agent 出网按 ADR-003 内网档（默认拒绝 + allowlist）。
- **后果**：交付物含 `compose.intranet.yml` 与 offline-bundle 手册；验收见 [18.7](18-intranet-offline.md)。

## ADR-012 工作区基数（按引擎分叉）

- **背景**：平台对等调度 OpenCode 与 Claude；若强制「每成员仅一个 Workspace」，切换引擎需销毁/重建卷与实例，体验差。
- **决策**：
  1. 基数公式为 **`Project × User × RuntimeType → Workspace → RuntimeInstance`**（一人可有最多两套个人工作区）。
  2. DDL 唯一键：`uq(project_id, owner_user_id, runtime_type)`（见 [15](15-database-ddl.md)）。
  3. `ensureWorkspace(project, user, runtimeType)`；顶栏/会话创建时显式选引擎或沿用项目默认绑定。
- **后果**：README「一人一工作区」口号废止；调度、配额、Apply 均按 `(workspace, runtimeType)` 计。

## ADR-013 external 实例绑定模型

- **背景**：早期方案要求 MVP 强制 `boundUserId`（一实例一成员）；与「项目绑定多实例、演示 shared」冲突。
- **决策**：
  1. **不**引入必填 `boundUserId`。
  2. 使用 `isolation`（`dedicated` | `shared`）+ `assignedProjectIds[]` 控制可见与调度范围。
  3. **`dedicated`（推荐）**：调度保证同一时刻一实例只服务一个 `(project,user)` 工作区会话注入；多项目可列在 `assignedProjectIds`，但仍按工作区独占进程（一人一进程）。
  4. **`shared`**：仅 internet-lab / 演示；Hub 强制单活跃用户；正式 intranet 交付禁止新建 `shared`（已有可禁用）。
- **后果**：验收 A1 按「登记 + 项目绑定 + isolation=dedicated」描述；主 plan 中 `boundUserId` MVP 必填作废。

## ADR-014 tenant.admin 与平台角色名

- **背景**：主 plan 曾用 `platform.operator`，且对 tenant.admin 是否自动拥有项目权限表述不一。
- **决策**：
  1. 平台超级用户角色名统一为 **`platform.admin`**（JWT claim `pa`）；废弃 `platform.operator` 称谓。
  2. **`tenant.admin` / `tenant.owner`**：在**管理面**权限判定视同该租户下所有项目的 `project.owner`（见 [03](03-auth-rbac.md)）。
  3. **会话面**仍仅 `session.own`：不可读他人会话正文；审计元数据走 `session.audit_meta`。
- **后果**：权限矩阵与 API 文档只用 `platform.admin`；实现与测试夹具同名。
