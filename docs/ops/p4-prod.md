# P4 生产加固

控制面和节点之间用双向 TLS。凭据和节点密码用信封加密，密钥可以轮换。指标和告警在内网就能演练。Kubernetes 清单只覆盖控制面。

## 双向 TLS

- Hub 用自己的 CA 给 node-agent 和 sync 客户端发证。证快到期时，心跳会带 `renew_cert_hint`，节点提交新的 CSR。
- Hub 调节点的创建、启动、停止，以及 `files/apply`、`common/sync`，都走这套客户端证。没有客户端证的握手会被拒绝。
- `agenthub-sync` 仍然要带 sync token。生产上可以再带 Hub CA 签发的客户端证，连到 Hub 的 mTLS 端口。token 决定是哪台实例，证书决定这条链路是不是 Hub 自己的。

## 密钥

- 不配置 `KMS_URL` 时，用本机密钥环：`AGENTHUB_MASTER_KEY`，以及 `AGENTHUB_MASTER_KEY_V1`、`_V2` 这类旧版本。最高版本用来加密新数据，窗口里的旧版本仍能解开。
- 配置了 `KMS_URL` 时，包装和解包都发给内网 KMS。代码里没有导出密钥的接口，调用会直接失败。
- 每个租户有一把数据密钥，包在 KEK 里，存在 `tenants.dek_ciphertext`。项目凭据用这把数据密钥加密，附加数据是 `租户|project|凭据 id|版本`，密文不能挪到另一行。
- 用户凭据和节点密码各自再包一把数据密钥。
- 轮换：先放上新版本（旧版本留着），然后由平台管理员调用 `POST /v1/admin/kek/reencrypt`，或让 hub-jobs 跑名为 `reencrypt` 的任务。旧版本计数归零之后，再拿掉旧密钥。返回里只有行数和版本号，没有明文。
- 更早写入的旧密文没有信封头，仍然能用 `PLATFORM_DEK` 解开。轮换任务会把它们收成新格式。

## 观测

- `GET /metrics` 输出 Prometheus 文本。设置 `OTEL_EXPORTER_OTLP_ENDPOINT` 后，进程每 30 秒向内网收集器推 OTLP JSON。
- 告警阈值写在 `deploy/observability/alerts.yml`，和架构文档 12.4 一致。演练不需要把系统打挂：程序用一组安静样本和一组故障样本走同一套阈值。

## Kubernetes

见 `deploy/k8s/README.md`。数据面仍是 Docker。不要在集群里为每个用户起工作区 Pod。

## RLS

`deploy/postgres/rls-reserved.sql` 是预留语句，**没有**放进现有迁移，也没有执行。原因：业务查询已经按租户过滤；打开 RLS 还要给每个事务设置 `app.tenant_id`，并给迁移和后台任务一个绕过角色。那是数据库契约变更，要单独评审后再做迁移。

## 一人一容器

managed 工作区的容器名是 `agenthub-{workspaceId}`，目录带用户 id，实例隔离仍是 `dedicated`。这次没有放宽。

## 怎么自己验收

在仓库根目录：

```bash
pnpm --filter @agenthub/hub-api exec vitest run src/lib/envelope.test.ts src/lib/kek.test.ts src/tests/prod-hardening.test.ts
pnpm --filter @agenthub/agenthub-sync test
pnpm --filter @agenthub/node-agent test
```

信封测试应打印轮换后仍能解开、换了附加数据就解不开。加固测试应打印告警演练通过，并且无证书的节点请求失败。

这是仓库里的自动检查，不是第三方渗透测试报告。若要对外签「无高危」，还需要你们请人做一次正式测试。
