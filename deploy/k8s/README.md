# 可选 Kubernetes（仅控制面）

数据面不进这个目录。工作区仍然是节点上的 Docker 容器，由 node-agent 创建，一人一容器。这是 ADR-002：首版不上 K8s 工作区，也不把容器运行时换成 gVisor 或 Kata。

`control-plane.yaml` 里只有：

- `hub-api`：无状态，HTTP 和节点 mTLS 两个端口
- `hub-jobs`：和 API 同一个镜像，靠队列抢任务
- 密钥走 Secret 引用，清单里不写密钥明文

没有 node-agent DaemonSet，也没有按用户创建的 Pod。Worker 节点继续用现有的 Docker 安装方式。

观测收集器是可选项，见 `deploy/observability/otel-collector.yaml`。不部署它时，Hub 仍在本进程里记指标，`/metrics` 可以直接看。
