import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DirectoryUser,
  ProjectMember,
  ProjectRole,
  TenantRole,
  UserBindings,
} from "@agenthub/domain";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  EmptyState,
  Field,
  FilterToolbar,
  Icon,
  Input,
  PageHeader,
  Select,
  Tabs,
  cn,
  ui,
  type AvatarTone,
} from "@agenthub/hub-ui-kit";
import { Plus, Shield } from "lucide-react";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";
import { Modal } from "../components/Modal.js";
import { api } from "../lib/api.js";
import { getApiErrorMessage } from "../lib/api-error.js";
import { useToast } from "../lib/toast.js";

type View = "project" | "users";

const ROLE_GUIDE = [
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
] as const;

const AVATAR_TONES: AvatarTone[] = ["green", "purple", "blue", "orange"];

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  return name.slice(0, 2).toUpperCase() || "??";
}

function avatarTone(seed: string): AvatarTone {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * (i + 1)) % 997;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

function tenantRoleOf(
  user: { tenants: Array<{ id: string; role: string }> } | null | undefined,
  tenantId: string | null,
) {
  if (!user || !tenantId) return undefined;
  return user.tenants.find((t) => t.id === tenantId)?.role;
}

type BindingDraft = {
  tenants: Record<
    string,
    {
      selected: boolean;
      role: TenantRole;
      projects: Record<string, { selected: boolean; role: ProjectRole }>;
    }
  >;
};

export function MembersPage() {
  const { user } = useAuth();
  const { tenantId, projectId, projects } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchParams] = useSearchParams();
  const [view, setView] = useState<View>(searchParams.get("view") === "users" ? "users" : "project");
  useEffect(() => {
    if (searchParams.get("view") === "users") setView("users");
  }, [searchParams]);
  const [userQuery, setUserQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<ProjectMember | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ProjectMember | null>(null);
  const [bindingUserId, setBindingUserId] = useState<string | null>(null);
  const [inviteForm, setInviteForm] = useState({
    displayName: "",
    email: "",
    role: "developer" as ProjectRole,
  });
  const [addUserForm, setAddUserForm] = useState({
    displayName: "",
    email: "",
  });
  const [roleForm, setRoleForm] = useState<ProjectRole>("developer");

  const currentProject = projects.find((p) => p.id === projectId) ?? null;
  const myTenantRole = tenantRoleOf(user, tenantId);
  const isPlatformAdmin = Boolean(user?.isPlatformAdmin);
  const canManageTenant =
    isPlatformAdmin || myTenantRole === "owner" || myTenantRole === "admin";
  const canManageProject =
    canManageTenant || currentProject?.myRole === "owner";

  const membersQuery = useQuery({
    queryKey: ["project-members", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => (await api.listProjectMembers(projectId!)).items,
  });

  const directoryQuery = useQuery({
    queryKey: ["directory-users", tenantId, userQuery],
    enabled: view === "users" && canManageTenant && Boolean(tenantId),
    queryFn: async () =>
      (
        await api.listDirectoryUsers({
          tenantId: tenantId ?? undefined,
          q: userQuery || undefined,
        })
      ).items,
  });

  const catalogQuery = useQuery({
    queryKey: ["bindings-catalog"],
    enabled: Boolean(bindingUserId),
    queryFn: async () => (await api.listBindingCatalog()).items,
  });

  const bindingsQuery = useQuery({
    queryKey: ["user-bindings", bindingUserId],
    enabled: Boolean(bindingUserId),
    queryFn: async () => api.getUserBindings(bindingUserId!),
  });

  const [draft, setDraft] = useState<BindingDraft | null>(null);

  useEffect(() => {
    if (!bindingUserId || !catalogQuery.data || !bindingsQuery.data) {
      setDraft(null);
      return;
    }
    const next: BindingDraft = { tenants: {} };
    for (const t of catalogQuery.data) {
      const bound = bindingsQuery.data.tenants.find((b) => b.tenantId === t.tenantId);
      const projectsState: BindingDraft["tenants"][string]["projects"] = {};
      for (const p of t.projects) {
        const pb = bindingsQuery.data.projects.find((b) => b.projectId === p.projectId);
        projectsState[p.projectId] = {
          selected: Boolean(pb),
          role: (pb?.role ?? "developer") as ProjectRole,
        };
      }
      next.tenants[t.tenantId] = {
        selected: Boolean(bound),
        role: (bound?.role ?? "member") as TenantRole,
        projects: projectsState,
      };
    }
    setDraft(next);
  }, [bindingUserId, catalogQuery.data, bindingsQuery.data]);

  const bindingUser = bindingsQuery.data;

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-members"] }),
      queryClient.invalidateQueries({ queryKey: ["directory-users"] }),
      queryClient.invalidateQueries({ queryKey: ["user-bindings"] }),
    ]);
  };

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!projectId || !tenantId) throw new Error("未选择项目");
      return api.createInvitation(tenantId, {
        email: inviteForm.email.trim(),
        displayName: inviteForm.displayName.trim() || undefined,
        tenantRole: "member",
        projectGrants: [{ projectId, role: inviteForm.role }],
      });
    },
    onSuccess: async (inv) => {
      setInviteOpen(false);
      setInviteForm({ displayName: "", email: "", role: "developer" });
      await invalidateAll();
      toast(
        inv.reusedExistingUser
          ? `已复用账号 ${inv.email} 并加入当前项目`
          : `已创建账号 ${inv.email} 并加入当前项目`,
      );
    },
    onError: async (err) => {
      toast(await getApiErrorMessage(err, "邀请失败"));
    },
  });

  const addUserMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("未选择租户");
      return api.createInvitation(tenantId, {
        email: addUserForm.email.trim(),
        displayName: addUserForm.displayName.trim() || undefined,
        tenantRole: "member",
      });
    },
    onSuccess: async (inv) => {
      setAddUserOpen(false);
      setAddUserForm({ displayName: "", email: "" });
      await invalidateAll();
      toast(
        inv.reusedExistingUser
          ? `已复用账号 ${inv.email}`
          : `已创建账号 ${inv.email}`,
      );
      setBindingUserId(inv.userId);
    },
    onError: async (err) => {
      toast(await getApiErrorMessage(err, "添加用户失败"));
    },
  });

  const patchRoleMutation = useMutation({
    mutationFn: async () => {
      if (!projectId || !roleTarget) throw new Error("无目标成员");
      return api.patchProjectMember(projectId, roleTarget.userId, roleForm);
    },
    onSuccess: async () => {
      setRoleTarget(null);
      await invalidateAll();
      toast("项目角色已更新");
    },
    onError: async (err) => {
      toast(await getApiErrorMessage(err, "更新角色失败"));
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (!projectId || !removeTarget) throw new Error("无目标成员");
      await api.removeProjectMember(projectId, removeTarget.userId);
    },
    onSuccess: async () => {
      setRemoveTarget(null);
      await invalidateAll();
      toast("已移除项目成员");
    },
    onError: async (err) => {
      toast(await getApiErrorMessage(err, "移除失败"));
    },
  });

  const saveBindingsMutation = useMutation({
    mutationFn: async () => {
      if (!bindingUserId || !draft || !catalogQuery.data) {
        throw new Error("绑定草稿未就绪");
      }
      const tenants = catalogQuery.data
        .filter((t) => t.canEdit && draft.tenants[t.tenantId]?.selected)
        .map((t) => {
          const state = draft.tenants[t.tenantId]!;
          return {
            tenantId: t.tenantId,
            role: state.role,
            projects: t.projects
              .filter((p) => state.projects[p.projectId]?.selected)
              .map((p) => ({
                projectId: p.projectId,
                role: state.projects[p.projectId]!.role,
              })),
          };
        });
      return api.putUserBindings(bindingUserId, { tenants });
    },
    onSuccess: async () => {
      setBindingUserId(null);
      await invalidateAll();
      toast("多租户与多项目绑定已保存");
    },
    onError: async (err) => {
      toast(await getApiErrorMessage(err, "保存绑定失败"));
    },
  });

  const members = membersQuery.data ?? [];
  const directory = directoryQuery.data ?? [];

  const bindingEditable = useMemo(
    () => (catalogQuery.data ?? []).some((t) => t.canEdit),
    [catalogQuery.data],
  );

  const openBindings = (userId: string) => {
    setBindingUserId(userId);
  };

  const onInviteSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!inviteForm.email.trim()) {
      toast("请输入邮箱");
      return;
    }
    inviteMutation.mutate();
  };

  const onAddUserSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!addUserForm.email.trim()) {
      toast("请输入邮箱");
      return;
    }
    addUserMutation.mutate();
  };

  if (!projectId) {
    return (
      <>
        <PageHeader
          eyebrow="项目配置"
          title="成员与角色"
          description="选择项目后管理成员与多空间绑定。"
        />
        <EmptyState surface>
          尚未选择项目。
          <br />
          请先在顶栏选择可用项目。
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="项目配置"
        title="成员与角色"
        description="让每位成员在明确的权限边界内协作。"
        actions={
          <>
            {view === "project" ? (
              <>
                {canManageTenant ? (
                  <Button
                    variant="secondary"
                    onClick={() => setView("users")}
                  >
                    用户与归属
                  </Button>
                ) : null}
                {canManageProject ? (
                  <Button onClick={() => setInviteOpen(true)}>
                    <Icon icon={Plus} size="sm" />
                    邀请成员
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                {canManageTenant ? (
                  <Button onClick={() => setAddUserOpen(true)}>
                    <Icon icon={Plus} size="sm" />
                    添加用户
                  </Button>
                ) : null}
              </>
            )}
          </>
        }
      />

      <Tabs
        aria-label="成员管理视图"
        value={view}
        onChange={setView}
        items={[
          { value: "project", label: "当前项目成员" },
          { value: "users", label: "用户与多空间绑定" },
        ]}
      />

      {view === "project" ? (
        <>
          <Banner icon={Shield}>
            管理员可查看成员工作区状态与会话审计元数据，默认不可查看成员会话正文。
          </Banner>

          <div className={cn(ui.surface, ui.tableWrap)}>
            {membersQuery.isLoading ? (
              <p className="p-4 text-[11px] text-[#667085]">加载成员…</p>
            ) : members.length === 0 ? (
              <EmptyState>
                暂无项目成员。
                <br />
                {canManageProject
                  ? "邀请成员加入当前项目，或在「用户与多空间绑定」中批量设置。"
                  : "当前项目还没有成员。"}
              </EmptyState>
            ) : (
              <table className={ui.dataTable}>
                <thead>
                  <tr>
                    <th>项目成员</th>
                    <th>项目角色</th>
                    <th>工作区</th>
                    <th>会话访问</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const isMe = m.userId === user?.id;
                    return (
                      <tr key={m.userId}>
                        <td className={ui.memberCell}>
                          <Avatar tone={avatarTone(m.email)}>
                            {initials(m.displayName)}
                          </Avatar>
                          <span>
                            <strong>{m.displayName}</strong>
                            <small>{m.email}</small>
                          </span>
                        </td>
                        <td>
                          <Badge tone={m.role === "owner" ? "green" : "default"}>
                            {m.role}
                          </Badge>
                        </td>
                        <td>
                          {m.role === "viewer" ? "未分配" : "独立个人工作区"}
                        </td>
                        <td>{isMe ? "仅本人正文" : "仅本人可见"}</td>
                        <td className={ui.tableActions}>
                          {isMe ? (
                            <span className={ui.badge}>当前用户</span>
                          ) : canManageProject ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setRoleTarget(m);
                                setRoleForm(m.role);
                              }}
                            >
                              管理角色
                            </Button>
                          ) : null}
                          {(canManageTenant || isMe) && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openBindings(m.userId)}
                            >
                              空间绑定
                            </Button>
                          )}
                          {!isMe && canManageProject ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setRemoveTarget(m)}
                            >
                              移除
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className={cn(ui.grid3, ui.roleGrid)}>
            {ROLE_GUIDE.map((r) => (
              <article key={r.role} className={cn(ui.surface, ui.assetCard)}>
                <Badge tone={r.role === "owner" ? "green" : "default"}>
                  {r.role}
                </Badge>
                <h3 className={ui.assetCardTitle}>{r.title}</h3>
                <p>{r.desc}</p>
              </article>
            ))}
          </div>
        </>
      ) : !canManageTenant ? (
        <EmptyState surface>
          需要租户管理员权限。
          <br />
          用户与多空间绑定由租户 owner / admin 管理。
          {user ? (
            <>
              <br />
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() => openBindings(user.id)}
              >
                查看我的租户与项目
              </Button>
            </>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <div className={cn(ui.surface, "mb-3 p-4")}>
            <strong className="text-[12px] text-[#182230]">
              一个账号，多个空间，独立权限
            </strong>
            <p className="m-0 mt-1.5 text-[11px] leading-relaxed text-[#667085]">
              租户角色与项目角色独立设置；项目绑定必须先具备其所属租户的成员关系。取消租户绑定会一并移除其下的项目绑定。
            </p>
            {user ? (
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openBindings(user.id)}
                >
                  我的归属
                </Button>
              </div>
            ) : null}
          </div>

          <FilterToolbar count={`${directory.length} 位用户 · 支持跨租户绑定`}>
            <label>
              <span className={ui.srOnly}>搜索用户</span>
              <Input
                variant="filter"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="搜索姓名或邮箱"
              />
            </label>
          </FilterToolbar>

          <div className={cn(ui.surface, ui.tableWrap)}>
            {directoryQuery.isLoading ? (
              <p className="p-4 text-[11px] text-[#667085]">加载用户…</p>
            ) : directory.length === 0 ? (
              <EmptyState>
                暂无用户。
                <br />
                添加用户后可绑定多个租户与项目。
              </EmptyState>
            ) : (
              <table className={ui.dataTable}>
                <thead>
                  <tr>
                    <th>用户账号</th>
                    <th>已绑定租户</th>
                    <th>已绑定项目</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {directory.map((u) => (
                    <DirectoryRow
                      key={u.userId}
                      user={u}
                      isMe={u.userId === user?.id}
                      onManage={() => openBindings(u.userId)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      <Modal
        open={inviteOpen}
        title="邀请项目成员"
        onClose={() => setInviteOpen(false)}
        footer={
          <Button
            type="submit"
            form="invite-member-form"
            disabled={inviteMutation.isPending}
          >
            {inviteMutation.isPending ? "提交中…" : "邀请并加入"}
          </Button>
        }
      >
        <form id="invite-member-form" className="grid gap-3" onSubmit={onInviteSubmit}>
          <Field label="显示名">
            <Input
              variant="field"
              value={inviteForm.displayName}
              onChange={(e) =>
                setInviteForm((s) => ({ ...s, displayName: e.target.value }))
              }
              placeholder="可选；已有账号时忽略"
            />
          </Field>
          <Field label="邮箱">
            <Input
              variant="field"
              type="email"
              required
              value={inviteForm.email}
              onChange={(e) =>
                setInviteForm((s) => ({ ...s, email: e.target.value }))
              }
              placeholder="name@example.com"
            />
          </Field>
          <Field label="项目角色">
            <Select
              variant="field"
              value={inviteForm.role}
              onChange={(e) =>
                setInviteForm((s) => ({
                  ...s,
                  role: e.target.value as ProjectRole,
                }))
              }
            >
              <option value="developer">developer</option>
              <option value="viewer">viewer</option>
              <option value="owner">owner</option>
            </Select>
          </Field>
          <p className="m-0 text-[10px] leading-relaxed text-[#98a2b3]">
            若邮箱已注册将复用已有账号，不会重复建号；同时确保其具备当前租户成员关系。
          </p>
        </form>
      </Modal>

      <Modal
        open={addUserOpen}
        title="添加用户账号"
        onClose={() => setAddUserOpen(false)}
        footer={
          <Button
            type="submit"
            form="add-user-form"
            disabled={addUserMutation.isPending}
          >
            {addUserMutation.isPending ? "创建中…" : "创建并绑定"}
          </Button>
        }
      >
        <form id="add-user-form" className="grid gap-3" onSubmit={onAddUserSubmit}>
          <Field label="显示名">
            <Input
              variant="field"
              value={addUserForm.displayName}
              onChange={(e) =>
                setAddUserForm((s) => ({ ...s, displayName: e.target.value }))
              }
            />
          </Field>
          <Field label="邮箱">
            <Input
              variant="field"
              type="email"
              required
              value={addUserForm.email}
              onChange={(e) =>
                setAddUserForm((s) => ({ ...s, email: e.target.value }))
              }
            />
          </Field>
          <p className="m-0 text-[10px] leading-relaxed text-[#98a2b3]">
            账号创建后可绑定多个租户和项目。已存在邮箱将复用账号。
          </p>
        </form>
      </Modal>

      <Modal
        open={Boolean(roleTarget)}
        title="管理项目角色"
        onClose={() => setRoleTarget(null)}
        footer={
          <Button
            disabled={patchRoleMutation.isPending}
            onClick={() => patchRoleMutation.mutate()}
          >
            {patchRoleMutation.isPending ? "保存中…" : "保存"}
          </Button>
        }
      >
        {roleTarget ? (
          <div className="grid gap-3">
            <p className="m-0">
              {roleTarget.displayName} · {roleTarget.email}
            </p>
            <Field label="项目角色">
              <Select
                variant="field"
                value={roleForm}
                onChange={(e) => setRoleForm(e.target.value as ProjectRole)}
              >
                <option value="owner">owner</option>
                <option value="developer">developer</option>
                <option value="viewer">viewer</option>
              </Select>
            </Field>
            <p className="m-0 text-[10px] text-[#98a2b3]">
              项目必须保留至少一名 owner。
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(removeTarget)}
        title="移除项目成员"
        onClose={() => setRemoveTarget(null)}
        footer={
          <Button
            disabled={removeMutation.isPending}
            onClick={() => removeMutation.mutate()}
          >
            {removeMutation.isPending ? "移除中…" : "确认移除"}
          </Button>
        }
      >
        {removeTarget ? (
          <p className="m-0">
            确认将 <strong>{removeTarget.displayName}</strong> 移出当前项目？若其为最后一名
            owner，操作将被拒绝。
          </p>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(bindingUserId)}
        title={bindingEditable ? "管理用户的租户与项目绑定" : "我的租户与项目"}
        onClose={() => setBindingUserId(null)}
        wide
        footer={
          bindingEditable ? (
            <Button
              disabled={saveBindingsMutation.isPending || !draft}
              onClick={() => saveBindingsMutation.mutate()}
            >
              {saveBindingsMutation.isPending ? "保存中…" : "保存绑定"}
            </Button>
          ) : undefined
        }
      >
        {!bindingUser || !draft || !catalogQuery.data ? (
          <p className="m-0">加载绑定…</p>
        ) : (
          <BindingDialogBody
            user={bindingUser}
            catalog={catalogQuery.data}
            draft={draft}
            editable={bindingEditable}
            onChange={setDraft}
          />
        )}
      </Modal>
    </>
  );
}

function DirectoryRow({
  user,
  isMe,
  onManage,
}: {
  user: DirectoryUser;
  isMe: boolean;
  onManage: () => void;
}) {
  return (
    <tr>
      <td className={ui.memberCell}>
        <Avatar tone={avatarTone(user.email)}>{initials(user.displayName)}</Avatar>
        <span>
          <strong>{user.displayName}</strong>
          {isMe ? (
            <>
              {" "}
              <Badge tone="green">当前用户</Badge>
            </>
          ) : null}
          <small>
            {user.email} · {user.userId.slice(0, 8)}
          </small>
        </span>
      </td>
      <td>
        <div className="flex flex-wrap gap-1.5">
          {user.tenants.length === 0 ? (
            <Badge>未绑定</Badge>
          ) : (
            user.tenants.map((t) => (
              <span key={t.tenantId} title={t.tenantName}>
                <Badge>
                  {t.tenantName} · {t.role}
                </Badge>
              </span>
            ))
          )}
        </div>
        <small className="mt-1 block text-[10px] text-[#98a2b3]">
          {user.tenants.length} 个租户
        </small>
      </td>
      <td>
        <div className="flex flex-wrap gap-1.5">
          {user.projects.length === 0 ? (
            <Badge>未绑定</Badge>
          ) : (
            user.projects.map((p) => (
              <span key={p.projectId} title={p.projectName}>
                <Badge>
                  {p.projectName} · {p.role}
                </Badge>
              </span>
            ))
          )}
        </div>
        <small className="mt-1 block text-[10px] text-[#98a2b3]">
          {user.projects.length} 个项目
        </small>
      </td>
      <td>
        <Button size="sm" variant="secondary" onClick={onManage}>
          管理绑定
        </Button>
      </td>
    </tr>
  );
}

function BindingDialogBody({
  user,
  catalog,
  draft,
  editable,
  onChange,
}: {
  user: UserBindings;
  catalog: Array<{
    tenantId: string;
    name: string;
    slug: string;
    status: "active" | "suspended";
    canEdit: boolean;
    projects: Array<{
      projectId: string;
      name: string;
      key: string;
      archivedAt: string | null;
    }>;
  }>;
  draft: BindingDraft;
  editable: boolean;
  onChange: (draft: BindingDraft) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3 border-b border-ah-line pb-3.5">
        <Avatar tone={avatarTone(user.email)}>{initials(user.displayName)}</Avatar>
        <div className="min-w-0 flex-1">
          <strong className="text-[13px] text-[#344054]">{user.displayName}</strong>
          <small className="mt-1.5 block text-[10px] text-[#667085]">
            {user.email} · 同一账号跨空间复用
          </small>
        </div>
        <Badge tone={editable ? "green" : "default"}>
          {editable ? "可编辑" : "只读"}
        </Badge>
      </div>

      <p className="m-0 text-[11px] leading-[1.8] text-[#667085]">
        勾选多个租户，再选择各租户下的项目。角色按空间分别生效，取消租户绑定会一并移除其下的项目绑定。
      </p>

      <div className="grid gap-3">
        {catalog.map((t) => {
          const state = draft.tenants[t.tenantId];
          if (!state) return null;
          const canEdit = editable && t.canEdit;
          return (
            <section
              key={t.tenantId}
              className="overflow-hidden rounded-lg border border-ah-line"
            >
              <div className="flex flex-wrap items-center gap-2.5 border-b border-ah-line bg-[#f8fafc] px-3.5 py-3">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-[#344054]">
                  <input
                    type="checkbox"
                    checked={state.selected}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const selected = e.target.checked;
                      onChange({
                        tenants: {
                          ...draft.tenants,
                          [t.tenantId]: {
                            ...state,
                            selected,
                            projects: Object.fromEntries(
                              Object.entries(state.projects).map(([id, p]) => [
                                id,
                                selected ? p : { ...p, selected: false },
                              ]),
                            ),
                          },
                        },
                      });
                    }}
                  />
                  <strong className="font-semibold">{t.name}</strong>
                </label>
                {t.status !== "active" ? <Badge tone="orange">已停用</Badge> : null}
                <label className="flex shrink-0 items-center gap-2 text-[10px] text-[#667085]">
                  租户角色
                  <Select
                    className="w-[110px]"
                    value={state.role}
                    disabled={!state.selected || !canEdit}
                    aria-label={`${t.name} 的租户角色`}
                    onChange={(e) =>
                      onChange({
                        tenants: {
                          ...draft.tenants,
                          [t.tenantId]: {
                            ...state,
                            role: e.target.value as TenantRole,
                          },
                        },
                      })
                    }
                  >
                    <option value="owner">owner</option>
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                  </Select>
                </label>
              </div>
              <div className="px-3.5 py-1.5 pl-9">
                {t.projects.length === 0 ? (
                  <p className="m-0 py-2 text-[11px] text-[#98a2b3]">
                    此租户暂无项目，可以先绑定租户。
                  </p>
                ) : (
                  t.projects.map((p) => {
                    const ps = state.projects[p.projectId]!;
                    return (
                      <div
                        key={p.projectId}
                        className="flex items-center justify-between gap-4 border-b border-[#f0f2f5] py-2.5 last:border-b-0"
                      >
                        <label className="flex min-w-0 items-center gap-2.5 text-[11px] text-[#475467]">
                          <input
                            type="checkbox"
                            checked={ps.selected}
                            disabled={!state.selected || !canEdit}
                            onChange={(e) =>
                              onChange({
                                tenants: {
                                  ...draft.tenants,
                                  [t.tenantId]: {
                                    ...state,
                                    projects: {
                                      ...state.projects,
                                      [p.projectId]: {
                                        ...ps,
                                        selected: e.target.checked,
                                      },
                                    },
                                  },
                                },
                              })
                            }
                          />
                          <span>
                            {p.name}
                            <small className="ml-1.5 text-[10px] text-[#98a2b3]">
                              {p.key}
                              {p.archivedAt ? " · 已归档" : ""}
                            </small>
                          </span>
                        </label>
                        <Select
                          className="w-[120px] shrink-0"
                          value={ps.role}
                          disabled={!state.selected || !ps.selected || !canEdit}
                          aria-label={`${p.name} 的项目角色`}
                          onChange={(e) =>
                            onChange({
                              tenants: {
                                ...draft.tenants,
                                [t.tenantId]: {
                                  ...state,
                                  projects: {
                                    ...state.projects,
                                    [p.projectId]: {
                                      ...ps,
                                      role: e.target.value as ProjectRole,
                                    },
                                  },
                                },
                              },
                            })
                          }
                        >
                          <option value="owner">owner</option>
                          <option value="developer">developer</option>
                          <option value="viewer">viewer</option>
                        </Select>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

      <p className="m-0 text-[10px] leading-relaxed text-[#98a2b3]">
        至少保留一名租户 owner 和项目 owner；停用租户与归档项目的绑定可保留，恢复前不可进入工作区。
      </p>
    </div>
  );
}
