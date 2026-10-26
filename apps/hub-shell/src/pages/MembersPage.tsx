import {
  Avatar,
  Badge,
  Banner,
  Button,
  PageHeader,
  cn,
  ui,
  Icon,
  type AvatarTone,
} from "@agenthub/hub-ui-kit";
import { Plus, Shield } from "lucide-react";
import { useAuth } from "../auth/AuthProvider.js";

const MEMBERS: Array<{
  name: string;
  initial: string;
  email: string;
  role: string;
  color: AvatarTone;
  tenants: number;
  projects: number;
  workspace: string;
  session: string;
}> = [
  {
    name: "Jack Lu",
    initial: "JL",
    email: "jack@northstar.example",
    role: "owner",
    color: "green",
    tenants: 1,
    projects: 1,
    workspace: "独立个人工作区",
    session: "仅本人正文",
  },
  {
    name: "Sarah Chen",
    initial: "SC",
    email: "sarah@northstar.example",
    role: "developer",
    color: "purple",
    tenants: 1,
    projects: 2,
    workspace: "独立个人工作区",
    session: "仅本人可见",
  },
  {
    name: "Alex Wang",
    initial: "AW",
    email: "alex@northstar.example",
    role: "developer",
    color: "blue",
    tenants: 1,
    projects: 1,
    workspace: "独立个人工作区",
    session: "仅本人可见",
  },
  {
    name: "Liam Zhang",
    initial: "LZ",
    email: "liam@northstar.example",
    role: "viewer",
    color: "orange",
    tenants: 1,
    projects: 1,
    workspace: "未分配",
    session: "仅本人可见",
  },
];

const ROLES = [
  {
    role: "owner",
    title: "项目管理",
    desc: "成员、实例绑定、凭据与受保护路径管理。",
  },
  {
    role: "developer",
    title: "开发协作",
    desc: "个人会话、创建问题、管理非保护公共资料。",
  },
  {
    role: "viewer",
    title: "只读访问",
    desc: "查看看板与公共资料，不可创建会话。",
  },
];

export function MembersPage() {
  const { user } = useAuth();
  const me = user?.displayName;

  return (
    <>
      <PageHeader
        eyebrow="项目配置"
        title="成员与角色"
        description="让每位成员在明确的权限边界内协作。"
        actions={
          <>
            <Button variant="secondary" disabled title="P1">
              用户与归属
            </Button>
            <Button disabled title="P1">
              <Icon icon={Plus} size="sm" />
              邀请成员
            </Button>
          </>
        }
      />

      <Banner icon={Shield}>
        管理员可查看成员工作区状态与会话审计元数据，默认不可查看成员会话正文。
      </Banner>

      <div className={cn(ui.surface, ui.tableWrap)}>
        <table className={ui.dataTable}>
          <thead>
            <tr>
              <th>项目成员</th>
              <th>项目角色</th>
              <th>空间归属</th>
              <th>工作区</th>
              <th>会话访问</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {MEMBERS.map((m) => {
              const isMe = me != null && m.name.startsWith(me.split(/\s+/)[0] ?? "");
              return (
                <tr key={m.email}>
                  <td className={ui.memberCell}>
                    <Avatar tone={m.color}>{m.initial}</Avatar>
                    <span>
                      <strong>{m.name}</strong>
                      <small>{m.email}</small>
                    </span>
                  </td>
                  <td>
                    <Badge tone={m.role === "owner" ? "green" : "default"}>{m.role}</Badge>
                  </td>
                  <td>
                    <span className={ui.badge}>{m.tenants} 个租户</span>{" "}
                    <span className={ui.badge}>{m.projects} 个项目</span>
                  </td>
                  <td>{m.workspace}</td>
                  <td>{isMe ? "仅本人正文" : m.session}</td>
                  <td className={ui.tableActions}>
                    {isMe ? (
                      <span className={ui.badge}>当前用户</span>
                    ) : (
                      <Button size="sm" variant="secondary" disabled title="P1">
                        管理角色
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" disabled title="P1">
                      空间绑定
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={cn(ui.grid3, ui.roleGrid)}>
        {ROLES.map((r) => (
          <article key={r.role} className={cn(ui.surface, ui.assetCard)}>
            <Badge tone={r.role === "owner" ? "green" : "default"}>{r.role}</Badge>
            <h3 className={ui.assetCardTitle}>{r.title}</h3>
            <p>{r.desc}</p>
          </article>
        ))}
      </div>
    </>
  );
}
