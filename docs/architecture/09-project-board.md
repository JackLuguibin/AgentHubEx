# 09 项目看板

项目维度问题跟踪（轻量，非 Jira），与 Agent 会话联动。

## 9.1 Issue 状态机

```plantuml
@startuml issue-state
[*] --> todo : 创建
todo --> in_progress : 拖拽 / 从 Issue 开会话
in_progress --> todo : 退回
in_progress --> in_review : 拖拽 / 接受会话「建议推进」
in_review --> in_progress : 验证不通过
in_review --> done : assignee/创建人确认
in_progress --> done : 直接关闭 (developer+)
todo --> cancelled
in_progress --> cancelled
in_review --> cancelled
done --> in_progress : 重新打开
cancelled --> todo : 恢复
done --> [*]
note right of in_review
Agent / 会话事件只能「提议」推进，
需人确认，避免误关
end note
@enduml
```

`owner` 可强制任意跳转（`issue.force_close`）。所有状态变更写 `issue_events`（时间线）。

## 9.2 数据补充

| 表 | 说明 |
|---|---|
| `project_issues` | 见 [02](02-domain-model.md)；`rank` 为 LexoRank 字符串，列内排序 |
| `issue_session_links` | 多对多 |
| `issue_events` | `(issueId, type: created|status_changed|assigned|linked|commented|proposal, from, to, actorId, at)` |
| `issue_proposals` | `(issueId, sessionId, toStatus, summary, state: pending|accepted|rejected)` |

## 9.3 从 Issue 一键开会话

```plantuml
@startuml issue-start
autonumber
actor Dev
participant "Board UI" as B
participant "hub-api" as H
database PG
participant Facade as F

Dev -> B : 卡片 PROJ-12「用 Agent 解决」
B -> H : GET /v1/projects/{p}/credentials/options
B -> Dev : 弹窗：凭据选择 + 引擎 + 初始 prompt(预填 Issue 描述)
Dev -> B : 确认
B -> F : POST /v1/projects/{p}/sessions\n{issueId, title:"PROJ-12 …", credentialId, initialPrompt}
F -> PG : 创建会话 (见 04 时序)
F -> PG : link + 若 status=todo → in_progress，assignee 为空则设为自己
F -> F : 发送 initialPrompt 作为首条消息
F --> B : session
B -> B : 打开 /p/{projectId}/workbench?session={id}
@enduml
```

初始 prompt 模板（项目可配置）：

```text
你正在处理 {{issue.key}}: {{issue.title}}
优先级: {{issue.priority}}  标签: {{issue.labels}}
描述:
{{issue.description}}
参考资料位于 project-common/ 目录（只读）。
```

## 9.4 会话结束提议推进

```plantuml
@startuml issue-proposal
autonumber
participant Runtime as R
participant "Gateway SSE" as G
participant "hub-jobs" as J
database PG
actor Assignee as A

R -> G : session.idle / result 事件
G -> J : SessionCompleted(sessionId)
J -> PG : 会话是否关联 Issue 且 Issue=in_progress?
alt 是
  J -> PG : INSERT issue_proposals(toStatus=in_review, summary=会话最后结果摘要)
  J -> A : 站内通知
  A -> PG : 接受 → status=in_review / 拒绝
end
@enduml
```

用户也可在 Workbench 顶栏点「标记关联解决」直接创建 proposal。

## 9.5 看板拖拽与排序

```plantuml
@startuml board-dnd
autonumber
participant "dnd-kit" as D
participant "Board store" as S
participant "hub-api" as H
database PG

D -> S : drop(card, toColumn, beforeId, afterId)
S -> S : 乐观更新
S -> H : PATCH /v1/issues/{id}\nIf-Match: <etag>\n{ status, position: { beforeId?, afterId? } }
H -> H : authz(issue.write) + 状态迁移合法性
H -> PG : rank = between(before, after)\nUPDATE ... WHERE etag 匹配
alt 并发冲突
  H --> S : 412 / 409 → 回滚并刷新列
else
  H -> H : 发布 board:{projectId} 事件 (Redis pub/sub)
  H --> S : 200 Issue（新 etag）
end
@enduml
```

看板实时性：`GET /v1/projects/{p}/board/events`（SSE）推送 `issue.upserted` / `issue.deleted`；必要时 `board.resync` 触发整板重拉。断线指数退避；失败则每 15s 轮询 `GET .../board`。

## 9.6 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/projects/{p}/board` | 各列卡片（cancelled 默认折叠，分页每列 50） |
| GET | `/v1/projects/{p}/issues?status=&assignee=&label=&priority=&q=` | 列表/筛选 |
| POST | `/v1/projects/{p}/issues` | 创建 |
| GET/PATCH/DELETE | `/v1/issues/{id}` | |
| POST/DELETE | `/v1/issues/{id}/links/{sessionId}` | 关联 / 解除（只能关联自己的会话） |
| GET | `/v1/issues/{id}/timeline` | 事件 |
| POST | `/v1/issues/{id}/proposals/{pid}/accept|reject` | |
| GET | `/v1/projects/{p}/board/stats?range=week` | todo/in_progress/done 计数、本周新增/关闭 |

**可见性**：Issue 对项目成员可见；但关联会话列表只对会话 owner 显示可打开链接，其他人看到「由 X 的会话处理」元数据。
