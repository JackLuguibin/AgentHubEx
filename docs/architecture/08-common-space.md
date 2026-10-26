# 08 项目公共空间

与个人工作区分离，存放项目共享资料；同步到个人工作区 `/workspace/project-common/` 只读。

## 8.1 存储布局

```plantuml
@startuml common-storage
database PG {
  rectangle "common_files\n(path, size, mime, checksum, current_version, deleted_at)" as F
  rectangle "common_file_versions\n(version, object_key, checksum)" as V
  rectangle "common_protected_prefixes" as P
  rectangle "projects.common_quota_bytes / common_used_bytes" as Q
}
cloud "S3 / MinIO" {
  rectangle "tenants/{t}/projects/{p}/common/{path}@v{n}\n(或 object_key = .../objects/{sha256})" as O
  rectangle "tenants/{t}/projects/{p}/common-snapshots/{snapshotHash}.tar.zst" as SN
}
F --> V
V --> O
F ..> SN : 同步时生成快照
@enduml
```

- 对象键采用**内容寻址** `objects/{sha256}`（同内容去重，版本只是指针）；路径映射在 PG。
- 快照：同步时按 `(path, checksum)` 列表计算 `snapshotHash`，相同则复用 tar。

## 8.2 路径安全规则（`packages/common-fs`）

```plantuml
@startuml path-safe
start
:输入 rawPath;
:NFC 归一化，统一 '/' 分隔;
if (含 '..' 段 / 以 '/' 开头 / 含 '\\0' / 控制字符?) then (是)
  :400 INVALID_PATH;
  stop
endif
if (段长 > 255 或 总长 > 1024 或 深度 > 32?) then (是)
  :400;
  stop
endif
if (命中保留前缀 .agenthub/ ?) then (是)
  :400;
  stop
endif
if (命中受保护前缀 且 角色 < owner?) then (是)
  :403 PROTECTED_PATH;
  stop
endif
:返回 canonicalPath;
stop
@enduml
```

zip 批量上传：流式解压，逐条走上述校验；拒绝符号链接条目；解压总大小与条目数受配额限制（防 zip bomb）。

## 8.3 上传与编辑

```plantuml
@startuml common-upload
autonumber
actor Dev
participant "Hub Shell" as S
participant "hub-api" as H
participant S3
database PG

Dev -> S : 上传文件到 docs/api.md
S -> H : POST /v1/projects/{p}/common/upload (multipart, 或先申请 presigned PUT)
H -> H : authz(common.write) + 路径校验 + 配额预检查
H -> S3 : 流式写入 objects/{sha256} (边写边算 hash)
H -> PG : BEGIN\nupsert common_files, insert version n+1\n更新 used_bytes\nCOMMIT
H -> PG : audit(common.write, path, version)
opt project.commonSyncPolicy == on_common_publish
  H -> H : enqueue CommonPushJob (节流 60s 合并)
end
H --> S : 201 {path, version}
@enduml
```

在线编辑文本：`PUT /common/files/{path}` 携带 `If-Match: <checksum>` 乐观锁，冲突返回 `412`。

## 8.4 同步到个人工作区

```plantuml
@startuml common-sync
autonumber
participant "触发\n(workspace 就绪 / 用户点击 / 推送)" as T
participant "hub-api" as H
database PG
participant S3
participant "文件通道\n(node-agent / agenthub-sync)" as F
collections "/workspace/project-common (ro)" as RO

T -> H : POST /v1/workspaces/{w}/sync-common
H -> PG : 读当前未删除文件列表 → snapshotHash
alt snapshotHash == workspace.commonSnapshotHash
  H --> T : noop
else
  H -> S3 : 若快照不存在则生成 tar.zst
  H -> H : 签发 5 分钟签名 URL
  H -> F : 任务 {url, snapshotHash, manifest}
  F -> F : 下载到 staging 目录，校验 manifest
  F -> RO : 原子切换 (rename staging → project-common.new;\n swap 符号链接 / bind mount 重挂)
  F --> H : ok
  H -> PG : workspace.commonSnapshotHash, commonSyncedAt
end
@enduml
```

- managed：`project-common` 是宿主机目录以 `ro` bind mount 进容器；Node Agent 在宿主机侧写入。
- external：agenthub-sync 写入工作目录下 `project-common/`，并 `chmod -R a-w`；同时在下发的 OpenCode permission 中 deny 对 `project-common/**` 的 edit/write。
- 若项目勾选 `includeCommonAgentsMd`，渲染时把 `project-common/AGENTS.md` 加入 `instructions[]`。

## 8.5 从工作区回流到公共空间

```plantuml
@startuml common-promote
autonumber
actor Dev
participant "Hub Shell" as S
participant "hub-api" as H
participant "Runtime /file" as R
database PG

Dev -> S : 在工作区选择文件 → 「提交到公共空间」 (目标路径)
S -> H : POST /v1/projects/{p}/common/promote\n{workspaceId, items:[{srcPath,destPath}]}
H -> H : authz(common.write) + workspace.own
H -> R : GET /file/content (逐个读取)
alt project.promoteRequiresReview
  H -> PG : 创建 CommonChangeRequest(pending)
  H --> S : 202 待 owner 审核
else
  H -> H : 走上传流程 (8.3)
  H --> S : 201
end
@enduml
```

Agent 自身无法直接写公共空间（只读挂载 + 无 Hub 凭证）。

## 8.6 软删除与回收

- `DELETE` → `deleted_at=now()`；回收期 30 天内可恢复；`hub-jobs` 每日清理过期条目并对无引用对象做 GC。
- 单文件历史版本保留最近 20 个（可配），回滚 = 新建版本指向旧对象。

## 8.7 API

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/v1/projects/{p}/common/tree?prefix=&depth=` | common.read |
| GET | `/v1/projects/{p}/common/files/{path}` (`?download=1`, `?version=`) | common.read |
| PUT | `/v1/projects/{p}/common/files/{path}` | common.write |
| PATCH | `/v1/projects/{p}/common/files/{path}` (`{move/rename}`) | common.write |
| DELETE | `/v1/projects/{p}/common/files/{path}` | common.write |
| POST | `/v1/projects/{p}/common/upload` / `upload-zip` | common.write |
| GET | `/v1/projects/{p}/common/files/{path}/versions` | common.read |
| POST | `/v1/projects/{p}/common/files/{path}/restore {version}` | common.write |
| GET | `/v1/projects/{p}/common/search?q=` | common.read |
| GET/PUT | `/v1/projects/{p}/common/settings` (配额、受保护前缀、同步策略) | common.write_protected |
| POST | `/v1/workspaces/{w}/sync-common` | workspace.own |
