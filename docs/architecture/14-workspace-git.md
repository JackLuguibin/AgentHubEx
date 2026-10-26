# 14 工作区代码种子与 Git

目标：每个成员的个人工作区都有一份**独立可写**的项目代码；Agent 可以提交、推送分支、创建 PR；Git 凭据不落盘、不进浏览器。

## 14.1 关键决策（ADR-005 / ADR-006）

| 项 | 方案 |
|---|---|
| 仓库来源 | `project_repos` 表，一个项目可挂 1..N 个仓库（首版 UI 只暴露 1 个主仓库） |
| 种子方式 | 每用户**独立 clone** 到 `/workspace/<repoSlug>`；不共享 worktree（多人共享 `.git` 有锁冲突与越权风险） |
| 加速 | node-agent 在节点维护 bare 镜像缓存 `/var/lib/agenthub/git-cache/<repoId>.git`，clone 用 `--reference-if-able --dissociate` |
| 默认分支 | 跟随仓库 `defaultBranch`；工作区创建后**不自动切新分支** |
| 工作分支命名 | `agenthub/<userHandle>/<issueKey或sessionShortId>-<slug>`，由「从 Issue 开会话」时自动创建 |
| 凭据来源 | 用户个人 Git 凭据（PAT）优先；项目可配置共享 Git 凭据（只读 deploy key 或 bot token） |
| 凭据注入 | 容器内 `git-credential-agenthub` helper → worker 内存，不写 `~/.git-credentials` |
| 提交身份 | `user.name / user.email` = Hub 用户显示名 / 邮箱；可加 `Co-authored-by: AgentHub Agent` trailer（项目开关） |
| PR 创建 | Hub 调 Git 平台 API（GitHub / GitLab / Gitea），用发起用户的凭据，在 Workbench / Issue 中一键创建 |
| external 模式 | 由运维自备代码目录；Hub 不 clone，仅在 `project_repos` 中记录 `workdirHint`；可选由 agenthub-sync 执行 clone |

## 14.2 数据模型

```plantuml
@startuml git-model
hide empty methods
class ProjectRepo {
  id; projectId
  provider: github|gitlab|gitea|generic
  cloneUrl (https)
  defaultBranch
  slug (目录名)
  isPrimary: bool
  seedPolicy: on_create|manual
  shallowDepth?: int
  branchPrefix = "agenthub/"
  commitTrailer: bool
}
class GitCredential {
  id
  ownerKind: user|project
  ownerId
  provider; host
  authType: pat|deploy_key|app_installation
  secretCiphertext; keyVersion
  scopes: read|write
  username?
  status
}
class WorkspaceRepo {
  workspaceId; repoId
  path
  status: pending|cloning|ready|failed
  headBranch; headSha
  dirty: bool
  lastFetchedAt
}
class SessionBranch {
  sessionId; repoId
  branch; baseBranch; baseSha
  prUrl?; prState?
}
ProjectRepo "1" -- "*" WorkspaceRepo
ProjectRepo "1" -- "*" SessionBranch
GitCredential "*" -- "1" ProjectRepo : 按 host 匹配
@enduml
```

## 14.3 Git 凭据解析

```plantuml
@startuml git-cred
start
:输入 user, repo, 操作 (fetch|push|api);
if (用户有该 host 的 active GitCredential?) then (是)
  if (操作 == push/api 且 scopes 不含 write?) then (是)
    :跳到项目凭据;
  else
    :使用用户凭据;
    stop
  endif
endif
if (项目有该 host 的 GitCredential?) then (是)
  if (操作 == push 且 project.allowSharedPush == false?) then (是)
    :错误 GIT_CREDENTIAL_REQUIRED\n(提示绑定个人 PAT);
    stop
  endif
  :使用项目凭据;
  stop
endif
if (仓库为公开且操作 == fetch?) then (是)
  :匿名;
  stop
endif
:错误 GIT_CREDENTIAL_REQUIRED;
stop
@enduml
```

默认 `allowSharedPush=false`：推送一律用个人身份，保证提交归属与平台权限一致。

## 14.4 工作区种子流程（managed）

```plantuml
@startuml git-seed
autonumber
participant "hub-api" as H
participant "node-agent" as N
collections "git-cache\n(bare 镜像)" as C
participant "worker 容器" as W
participant "Git 平台" as G

H -> N : POST /workspaces/{w}/repos/seed\n{repoId, cloneUrl, defaultBranch, depth?, credToken}
N -> N : 节点锁 lock:repo:{repoId}
alt 缓存不存在
  N -> G : git clone --mirror (项目凭据或用户凭据, 经一次性 credToken 向 Hub 换取)
else
  N -> G : git remote update --prune (最多每 5 分钟一次)
end
N -> W : exec: git clone --reference-if-able C --dissociate\n  -b defaultBranch cloneUrl /workspace/<slug>
W -> W : git config user.name/email\ncredential.helper=agenthub\nsafe.directory=/workspace/*
W --> N : headSha
N --> H : {status: ready, headBranch, headSha}
H -> H : workspace_repos 更新；workspace 状态进入 applying
@enduml
```

- clone 在容器内执行（文件属主即容器用户），但网络凭据通过 helper 获取，与后续 Agent 使用同一机制。
- 失败（凭据缺失/仓库不可达）：`workspace_repos.status=failed`，工作区仍可 `ready_degraded` 进入，Shell 提示「绑定 Git 凭据后重试」。

## 14.5 容器内凭据 helper

```plantuml
@startuml git-helper
autonumber
participant "git" as GIT
participant "git-credential-agenthub\n(镜像内脚本)" as HP
participant "worker/common\n127.0.0.1 内部端口" as WK
participant "hub-api" as H

GIT -> HP : get (protocol=https, host=github.com, path=org/repo)
HP -> WK : POST /internal/git-credential {host, path, op}
note right of WK : 内部端口仅监听 127.0.0.1，\n需容器内 /run/agenthub/token (tmpfs, 0400)
WK -> WK : 内存缓存命中? (TTL 10min)
alt 未命中
  WK -> H : POST /v1/internal/workspaces/{w}/git-credential\n(实例身份认证)
  H -> H : 14.3 解析 + 解密 + 审计 (仅 id)
  H --> WK : {username, password(token), expiresAt}
end
WK --> HP : username=..., password=...
HP --> GIT : 输出凭据 (不缓存到磁盘)
@enduml
```

> 风险说明：`internet-lab` 出网较松时，Agent 理论上能读取 helper 返回的 token 并外传。**intranet/airgap** 默认拒公网 + Git 在 allowlist，外传面更小。缓解：细粒度/短期 PAT；Phase 3 可改为 Hub Git 代理（`https://hub/git/...`），容器内只持代理 token。

## 14.6 从 Issue 开会话时的分支

```plantuml
@startuml git-branch
autonumber
participant Facade as F
participant "worker" as W
database PG

F -> PG : session 创建 (带 issueId)
F -> W : exec in /workspace/<slug>:\n git fetch origin <defaultBranch>
alt 工作区 dirty
  F -> F : 不切分支，事件提示\n「工作区有未提交修改，已在当前分支继续」
else
  F -> W : git switch -c agenthub/<user>/<PROJ-12>-<slug> origin/<defaultBranch>
end
F -> PG : INSERT session_branches(branch, baseBranch, baseSha)
F -> W : 首条 prompt 附加：\n「当前分支 X，完成后请提交到该分支，不要推送到 defaultBranch」
@enduml
```

- 不阻止 Agent 自行切分支；`session_branches` 只记录会话起点。
- 推送保护：下发的 OpenCode permission 对 `git push * <defaultBranch>`、`git push --force*` 设为 `ask`（Bundle 内置规则，项目可改）。

## 14.7 推送与创建 PR

```plantuml
@startuml git-pr
autonumber
actor U
participant "Workbench / Issue 页" as UI
participant "hub-api" as H
participant "worker" as W
participant "Git 平台 API" as G
database PG

U -> UI : 「创建 PR」
UI -> H : POST /v1/sessions/{id}/git/pull-request\n{repoId, title?, body?, draft: true}
H -> W : git status --porcelain / rev-parse HEAD / 是否已推送
alt 有未推送提交
  H -> W : git push -u origin <branch> (helper 取用户凭据)
end
H -> H : 解析用户 Git 凭据 (需 write/api)
H -> G : POST /repos/{o}/{r}/pulls\n{head: branch, base: baseBranch, title, body, draft}
note right of H
title 默认: "PROJ-12: <issue.title>"
body 默认: Issue 链接 + 会话摘要 + 变更文件列表
end note
G --> H : {url, number}
H -> PG : session_branches.prUrl / prState=open
H -> PG : issue_events(linked_pr)；可提议 issue → in_review
H --> UI : {prUrl}
@enduml
```

PR 状态回流：Phase 2 接 Git 平台 webhook（`/v1/webhooks/git/{provider}`，HMAC 校验），`merged` 时提议 Issue → `done`。

## 14.8 工作区内多仓库与目录约定

```text
/workspace/
  <primary-repo-slug>/        # 主仓库（OpenCode 的工作目录 cwd）
  <other-repo-slug>/          # 附加仓库（可选）
  project-common/             # 公共空间只读镜像 (08)
  AGENTS.md                   # Hub 下发（受管文件）
  .opencode/                  # Hub 下发（受管文件）
  .agenthub/managed.json      # 受管清单
```

OpenCode 进程 `cwd=/workspace`，主仓库路径写入 `AGENTS.md` 头部提示，保证 Agent 同时看得到代码与 `project-common/`。

## 14.9 生命周期与清理

| 事件 | 处理 |
|---|---|
| 工作区 stop | 不动代码；`dirty` 状态记录在 `workspace_repos` |
| 工作区重建（镜像升级） | 卷保留，代码不受影响 |
| 成员移除 | 保留卷 7 天；若 `dirty` 或有未推送提交，通知项目 owner |
| 卷删除前 | 生成 `git bundle --all` 存 S3 30 天（可选，项目开关） |
| git-cache GC | 节点每日 `git gc --auto`；30 天未使用的镜像删除 |

## 14.10 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/v1/projects/{p}/repos` | 项目仓库 |
| PATCH/DELETE | `/v1/projects/{p}/repos/{repoId}` | |
| GET/PUT/DELETE | `/v1/me/git-credentials[/{id}]` | 个人 Git 凭据（只写不读） |
| GET/PUT/DELETE | `/v1/projects/{p}/git-credentials[/{id}]` | 项目 Git 凭据（owner） |
| POST | `/v1/workspaces/{w}/repos/{repoId}/seed` | 重新 clone / 重试 |
| GET | `/v1/workspaces/{w}/repos` | 状态（分支、sha、dirty） |
| POST | `/v1/workspaces/{w}/repos/{repoId}/fetch` | |
| POST | `/v1/sessions/{id}/git/pull-request` | 推送 + 建 PR |
| POST | `/v1/webhooks/git/{provider}` | PR 状态回流（P2） |
