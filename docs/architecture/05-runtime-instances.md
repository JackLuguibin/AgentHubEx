# 05 运行时实例、Node Agent 与调度

## 5.1 两种接入模式

| | external（登记连接） | managed（Node Agent 编排） |
|---|---|---|
| 创建者 | 运维自行部署 `opencode serve` | Node Agent 按 `(project,user)` 拉起 |
| 登记方式 | 门户手填 URL + Basic Auth | 自动写入 `runtime_instances` |
| 文件下发 | 需 `agenthub-sync` sidecar | Node Agent 写卷 |
| 隔离 | 推荐一进程一用户；`isolation=shared` 仅演示 | 强制一容器一工作区 |
| 阶段 | Phase 1 主路径 | Phase 2 |

## 5.2 external 实例登记流程

```plantuml
@startuml ext-register
autonumber
actor Admin
participant "Hub Shell" as S
participant "hub-api\nInstanceRegistry" as H
participant "远程 opencode serve" as R
database PG

Admin -> S : 添加远程实例 (name, baseUrl, user/pass, labels, isolation)
S -> H : POST /v1/admin/instances/test {baseUrl, auth}
H -> H : SSRF 校验（禁止 169.254.*、localhost 除非白名单；DNS 解析后再校验）
H -> R : GET /global/health (Basic Auth)
R --> H : 200 {version}
H -> R : GET /project (可选)
H --> S : 探测结果 {ok, version, latencyMs}
Admin -> S : 保存
S -> H : POST /v1/admin/instances
H -> PG : INSERT runtime_instances(mode=external, auth 加密, health=healthy)
H -> H : 生成 sync token（若勾选 hasSyncAgent）
H --> S : 实例 + sync 安装命令（token 仅显示一次）
@enduml
```

## 5.3 实例健康状态机

```plantuml
@startuml instance-state
[*] --> pending : 登记 / 容器创建
pending --> healthy : 探测成功
pending --> unhealthy : 探测失败
healthy --> degraded : 延迟 > 阈值 或 1 次失败
degraded --> healthy : 连续 2 次成功
degraded --> unhealthy : 连续 3 次失败
unhealthy --> healthy : 连续 2 次成功
healthy --> disabled : 管理员禁用
degraded --> disabled
unhealthy --> disabled
disabled --> pending : 重新启用
disabled --> [*] : 删除（无绑定工作区）
note right of unhealthy
  调度器跳过；
  绑定在其上的 workspace → status=unavailable，
  Gateway 返回 502 UPSTREAM_UNAVAILABLE
end note
@enduml
```

健康探测：`hub-jobs` 每 30s 对 healthy 实例、每 10s 对 degraded/unhealthy 实例 `GET /global/health`（managed 走 worker `/health`）。

## 5.4 Workspace 生命周期

```plantuml
@startuml workspace-state
[*] --> provisioning : 首次进入项目 (懒创建)
provisioning --> seeding : 实例就绪
seeding --> applying : git clone / worktree 完成
applying --> ready : Config Apply + 公共空间同步成功
applying --> ready_degraded : Apply 部分失败 (非 strict)
ready_degraded --> applying : 重新同步
ready --> applying : 新 revision / 手动同步
ready --> idle : 无会话活动 > idleTTL (默认 30min)
idle --> ready : 用户进入 (managed: start 容器)
idle --> stopped : > stopTTL (默认 24h)，managed 停容器
stopped --> provisioning : 用户进入
ready --> revoked : 成员被移除
idle --> revoked
stopped --> revoked
revoked --> deleted : 保留期结束
provisioning --> failed : 调度/创建失败
failed --> provisioning : 重试
deleted --> [*]
@enduml
```

> external 模式下 `idle/stopped` 只是 Hub 侧标记，不会去停远程进程。

## 5.5 调度算法（managed）

```plantuml
@startuml schedule
start
:输入 (project, user, runtimeType);
:读取 ProjectRuntimeBinding (按 priority);
if (binding 指定 instanceId?) then (是)
  :直接使用该实例\n(external 路径);
  stop
endif
:按 labelSelector 过滤 Node;
:过滤 status=healthy 且心跳 < 60s;
:过滤剩余容量 >= workspace 规格;
if (候选为空?) then (是)
  :workspace.status=failed\nreason=NO_CAPACITY;
  :告警;
  stop
endif
if (该用户在候选节点上有已停止卷?) then (是)
  :选该节点 (卷粘性);
else
  :按 score 排序\nscore = 0.5*cpu空闲 + 0.3*mem空闲 + 0.2*(1-workspace数/上限);
  :取最高分;
endif
:Redis 分布式锁 lock:node:{id} 预占容量;
:调用 Node Agent POST /workspaces;
stop
@enduml
```

## 5.6 Node Agent 注册与心跳

```plantuml
@startuml node-register
autonumber
actor Ops
participant "node-agent" as N
participant "hub-api" as H
database PG

Ops -> H : 门户生成 bootstrap token (一次性, 1h)
Ops -> N : 安装：AGENTHUB_URL + BOOTSTRAP_TOKEN
N -> N : 生成密钥对 + CSR
N -> H : POST /v1/nodes/register {token, csr, capacity, labels}
H -> PG : 校验 token，INSERT nodes
H --> N : 客户端证书 + Hub CA
loop 每 15s
  N -> H : POST /v1/nodes/heartbeat (mTLS)\n{capacity, used, workspaces[]}
  H -> PG : 更新容量；对账 workspace 列表
  H --> N : pendingCommands[] (可选拉模式)
end
@enduml
```

## 5.7 Node Agent 创建工作区

```plantuml
@startuml node-create
autonumber
participant "hub-api" as H
participant "node-agent" as N
participant Docker as D
participant "worker 容器" as W

H -> N : POST /workspaces (mTLS)\n{workspaceId, tenantId, projectId, userId,\n runtimeType, image, resources, gitSeed?, bootToken}
N -> N : mkdir /workspaces/{t}/{p}/{u}/{w}\n(chown 10001, quota)
N -> D : create container\n- image agenthub/worker-{type}@digest\n- user 10001\n- cap-drop ALL, no-new-privileges\n- mounts: workspace(rw), project-common(ro)\n- network: agenthub-ws (icc=false)\n- labels: tenant/project/user/workspace
N -> D : start
D -> W : 启动 worker/common
W -> W : 生成实例密码 (或使用 bootToken 派生)
W --> N : /health ready
N --> H : 201 {endpoint: http://node-x:port, authSecret(加密回传)}
H -> H : INSERT runtime_instances(mode=managed)
@enduml
```

**Node Agent API（mTLS）**

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/workspaces` | create + start |
| POST | `/workspaces/:id/start` / `stop` | |
| DELETE | `/workspaces/:id?purgeVolume=` | |
| POST | `/workspaces/:id/files/apply` | 写入渲染后的配置文件树（tar + manifest） |
| POST | `/workspaces/:id/common/sync` | 用签名 URL 拉公共空间镜像到 ro 目录 |
| GET | `/health`, `/capacity` | |

## 5.8 容器安全基线（ADR-002 / ADR-003：保持简单）

| 项 | 要求 | 不做 |
|---|---|---|
| 运行时 | Docker 默认 runc | 不用 gVisor / Kata；首版不上 K8s |
| 用户 | 非 root（uid 10001），镜像内可用 `sudo`-less 的用户级包管理（npm/pip --user） | |
| 根文件系统 | 可写（便于装依赖）；容器重建即还原 | 不做只读根 |
| 能力 | `cap-drop=ALL`，`no-new-privileges`，Docker 默认 seccomp | 不写自定义 seccomp/AppArmor |
| 挂载 | 本 workspace 卷 `/workspace`(rw) + `project-common`(ro)；禁止 docker.sock | |
| 网络 | 所有工作区共用 `agenthub-ws` bridge，`icc=false`（容器间不通）；worker 端口只绑节点内网 IP | 不做每工作区独立网络 |
| 出网 | **默认放开**；`DOCKER-USER` 链仅拒绝云元数据地址与控制面网段；DNS 日志审计 | 不做域名白名单 |
| 资源 | `--cpus`、`--memory`、`--pids-limit=1024`；磁盘用定时 `du` 巡检超额告警（软限制） | 不做 xfs 硬配额 |
| 凭据 | 只在进程内存或 OpenCode auth 存储（`/run/agenthub` tmpfs）；不落 workspace 卷 | |

默认规格：`2 CPU / 4 GiB / 磁盘软限 20 GiB`，项目可调。

```bash
# node-agent 在节点初始化时写入的出网规则（示意）
iptables -I DOCKER-USER -s 172.30.0.0/16 -d 169.254.169.254 -j DROP
iptables -I DOCKER-USER -s 172.30.0.0/16 -d ${CONTROL_PLANE_CIDR} -j DROP
```
