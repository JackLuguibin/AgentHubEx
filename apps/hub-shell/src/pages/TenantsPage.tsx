import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { Tenant } from "@agenthub/domain";
import {
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
  Stat,
  StatGrid,
  cn,
  ui,
} from "@agenthub/hub-ui-kit";
import { Info, Plus, FolderKanban } from "lucide-react";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";
import { Modal } from "../components/Modal.js";
import { api } from "../lib/api.js";
import { getApiErrorMessage } from "../lib/api-error.js";
import { useToast } from "../lib/toast.js";

type TenantFormState = {
  name: string;
  slug: string;
  ownerEmail: string;
  maxConcurrentSessionsPerUser: number;
  maxActiveWorkspaces: number;
  tokensPerDay: string;
};

const emptyForm = (): TenantFormState => ({
  name: "",
  slug: "",
  ownerEmail: "",
  maxConcurrentSessionsPerUser: 5,
  maxActiveWorkspaces: 50,
  tokensPerDay: "",
});

function formatQuota(t: Tenant) {
  const tokens =
    t.quota.tokensPerDay != null ? `${t.quota.tokensPerDay} Token / 日` : "Token 不限";
  return {
    primary: `${t.quota.maxConcurrentSessionsPerUser} 并发`,
    secondary: `${tokens} · ${t.quota.maxActiveWorkspaces} 工作区`,
  };
}

export function TenantsPage() {
  const { user, refreshMe } = useAuth();
  const { tenantId, switchTenant, projects, projectId } = useTenant();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "suspended">(
    "all",
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [form, setForm] = useState<TenantFormState>(emptyForm);
  const [detail, setDetail] = useState<Tenant | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<Tenant | null>(null);

  const isAdmin = Boolean(user?.isPlatformAdmin);

  const tenantsQuery = useQuery({
    queryKey: ["admin-tenants"],
    enabled: isAdmin,
    queryFn: async () => (await api.listAdminTenants()).items,
  });

  const membershipTenants = user?.tenants ?? [];

  const tenants: Tenant[] = useMemo(() => {
    if (isAdmin && tenantsQuery.data) return tenantsQuery.data;
    // Non-admin: synthesize from Me (no quota detail).
    return membershipTenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      quota: {
        maxConcurrentSessionsPerUser: 5,
        maxActiveWorkspaces: 50,
      },
      settings: { allowedLoginMethods: ["password"] },
      createdAt: new Date(0).toISOString(),
    }));
  }, [isAdmin, tenantsQuery.data, membershipTenants]);

  const ownersQuery = useQuery({
    queryKey: ["tenant-owners", tenants.map((t) => t.id).join(",")],
    enabled: isAdmin && tenants.length > 0,
    queryFn: async () => {
      const map = new Map<string, { displayName: string; email: string }>();
      await Promise.all(
        tenants.map(async (t) => {
          try {
            const page = await api.listTenantMembers(t.id);
            const owner = page.items.find((m) => m.role === "owner") ?? page.items[0];
            if (owner) {
              map.set(t.id, {
                displayName: owner.displayName,
                email: owner.email,
              });
            }
          } catch {
            /* ignore */
          }
        }),
      );
      return map;
    },
  });

  const projectCountsQuery = useQuery({
    queryKey: ["tenant-project-counts", tenants.map((t) => t.id).join(",")],
    enabled: isAdmin && tenants.length > 0,
    queryFn: async () => {
      const map = new Map<string, number>();
      await Promise.all(
        tenants.map(async (t) => {
          try {
            const [active, archived] = await Promise.all([
              api.listProjects(t.id),
              api.listProjects(t.id, { archived: true }),
            ]);
            map.set(t.id, active.items.length + archived.items.length);
          } catch {
            map.set(t.id, t.id === tenantId ? projects.length : 0);
          }
        }),
      );
      return map;
    },
  });

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tenants.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (!q) return true;
      return t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q);
    });
  }, [tenants, query, statusFilter]);

  const activeCount = tenants.filter((t) => t.status === "active").length;
  const concurrencyTotal = tenants
    .filter((t) => t.status === "active")
    .reduce((n, t) => n + t.quota.maxConcurrentSessionsPerUser, 0);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-tenants"] });
    await queryClient.invalidateQueries({ queryKey: ["tenant-owners"] });
    await queryClient.invalidateQueries({ queryKey: ["tenant-project-counts"] });
    await refreshMe();
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        const tokens =
          form.tokensPerDay.trim() === ""
            ? undefined
            : Number(form.tokensPerDay);
        return api.patchTenant(editing.id, {
          name: form.name.trim(),
          quota: {
            maxConcurrentSessionsPerUser: form.maxConcurrentSessionsPerUser,
            maxActiveWorkspaces: form.maxActiveWorkspaces,
            ...(tokens != null && !Number.isNaN(tokens)
              ? { tokensPerDay: tokens }
              : {}),
          },
        });
      }
      const created = await api.createTenant({
        name: form.name.trim(),
        slug: form.slug.trim(),
        ownerEmail: form.ownerEmail.trim(),
      });
      const tokens =
        form.tokensPerDay.trim() === "" ? undefined : Number(form.tokensPerDay);
      if (
        form.maxConcurrentSessionsPerUser !== 5 ||
        form.maxActiveWorkspaces !== 50 ||
        tokens != null
      ) {
        return api.patchTenant(created.id, {
          quota: {
            maxConcurrentSessionsPerUser: form.maxConcurrentSessionsPerUser,
            maxActiveWorkspaces: form.maxActiveWorkspaces,
            ...(tokens != null && !Number.isNaN(tokens)
              ? { tokensPerDay: tokens }
              : {}),
          },
        });
      }
      return created;
    },
    onSuccess: async () => {
      toast(editing ? "租户已更新" : "租户已创建");
      setFormOpen(false);
      setEditing(null);
      await invalidate();
    },
    onError: async (err) => {
      toast(await getApiErrorMessage(err, "保存租户失败"));
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (t: Tenant) => {
      if (t.status === "active") return api.suspendTenant(t.id);
      return api.unsuspendTenant(t.id);
    },
    onSuccess: async (updated) => {
      toast(updated.status === "suspended" ? "租户已停用" : "租户已恢复");
      setConfirmStatus(null);
      setDetail(null);
      await invalidate();
      if (updated.status === "suspended" && updated.id === tenantId) {
        const next = (user?.tenants ?? []).find(
          (t) => t.id !== updated.id && t.status === "active",
        );
        if (next) {
          await switchTenant(next.id);
          navigate(`/t/${next.id}/projects`);
        } else {
          navigate("/tenants");
        }
      }
    },
    onError: async (err) => {
      toast(await getApiErrorMessage(err, "更新租户状态失败"));
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyForm(),
      ownerEmail: user?.email ?? "",
    });
    setFormOpen(true);
  };

  const openEdit = (t: Tenant) => {
    setEditing(t);
    const owner = ownersQuery.data?.get(t.id);
    setForm({
      name: t.name,
      slug: t.slug,
      ownerEmail: owner?.email ?? user?.email ?? "",
      maxConcurrentSessionsPerUser: t.quota.maxConcurrentSessionsPerUser,
      maxActiveWorkspaces: t.quota.maxActiveWorkspaces,
      tokensPerDay:
        t.quota.tokensPerDay != null ? String(t.quota.tokensPerDay) : "",
    });
    setFormOpen(true);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast("请输入租户名称");
      return;
    }
    if (!editing && !/^[a-z0-9][a-z0-9-]{1,38}$/.test(form.slug.trim())) {
      toast("租户标识格式不正确");
      return;
    }
    if (!editing && !form.ownerEmail.trim()) {
      toast("请输入所有者邮箱");
      return;
    }
    saveMutation.mutate();
  };

  if (!isAdmin) {
    return (
      <>
        <PageHeader
          eyebrow="PLATFORM / TENANTS"
          title="租户管理"
          description="平台管理员统一管理组织边界。"
        />
        <EmptyState surface>
          需要平台管理员权限。当前账号无法访问租户管理。
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="PLATFORM / TENANTS"
        title="租户管理"
        description="管理组织、所有者、资源配额与租户生命周期。"
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!projectId}
              title={projectId ? "打开当前项目的成员与归属" : "请先选择项目"}
              onClick={() => {
                if (projectId) navigate(`/p/${projectId}/members?view=users`);
              }}
            >
              用户与归属
            </Button>
            <Button onClick={openCreate}>
              <Icon icon={Plus} size="sm" />
              新建租户
            </Button>
          </>
        }
      />

      <StatGrid>
        <Stat label="全部租户" value={tenants.length} note="按 tenant_id 隔离" />
        <Stat label="运行中" value={activeCount} note="可访问项目与工作区" />
        <Stat
          label="项目总数"
          value={
            projectCountsQuery.data
              ? [...projectCountsQuery.data.values()].reduce((a, b) => a + b, 0)
              : projects.length
          }
          note="项目归属于唯一租户"
        />
        <Stat label="并发总额度" value={concurrencyTotal} note="运行中租户配额合计" />
      </StatGrid>

      <div className={cn(ui.surface, ui.managementGuidance)}>
        <div>
          <strong>平台管理边界</strong>
          <p>平台管理员管理租户元数据与配额；成员的会话正文与个人凭据保持私有。</p>
        </div>
        <Badge tone="purple">平台管理员</Badge>
      </div>

      <FilterToolbar count={`${list.length} 个租户`}>
        <label>
          <span className={ui.srOnly}>搜索租户</span>
          <Input
            variant="filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称或标识"
          />
        </label>
        <Select
          aria-label="租户状态"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "all" | "active" | "suspended")
          }
        >
          <option value="all">全部状态</option>
          <option value="active">运行中</option>
          <option value="suspended">已停用</option>
        </Select>
      </FilterToolbar>

      <Banner icon={Info}>
        切换租户会刷新 JWT 中的 tenant 声明；项目列表与工作区上下文随之切换。停用租户后不再出现在顶栏切换器。
      </Banner>

      {tenantsQuery.isLoading ? (
        <EmptyState surface>加载租户…</EmptyState>
      ) : (
        <div className={cn(ui.surface, ui.tableWrap)}>
          <table className={ui.dataTable}>
            <thead>
              <tr>
                <th>租户 / 标识</th>
                <th>所有者</th>
                <th>项目数</th>
                <th>资源配额</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => {
                const quota = formatQuota(t);
                const owner = ownersQuery.data?.get(t.id);
                return (
                  <tr key={t.id}>
                    <td>
                      <strong className="inline-flex items-center gap-1">
                        <Icon icon={FolderKanban} size="xs" />
                        {t.name}
                      </strong>
                      {t.id === tenantId ? (
                        <Badge tone="green">当前租户</Badge>
                      ) : null}
                      <small>
                        {t.slug} · {t.id.slice(0, 8)}…
                      </small>
                    </td>
                    <td>
                      {owner?.displayName ?? "—"}
                      <small>{owner?.email ?? ""}</small>
                    </td>
                    <td>
                      {projectCountsQuery.data?.get(t.id) ??
                        (t.id === tenantId ? projects.length : "—")}
                    </td>
                    <td>
                      <strong>{quota.primary}</strong>
                      <small>{quota.secondary}</small>
                    </td>
                    <td>
                      <Badge tone={t.status === "active" ? "green" : "orange"}>
                        {t.status === "active" ? "运行中" : "已停用"}
                      </Badge>
                    </td>
                    <td className={ui.tableActions}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setDetail(t)}
                      >
                        详情
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openEdit(t)}
                      >
                        编辑
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 ? (
                <tr>
                  <td colSpan={6} className={ui.empty}>
                    没有匹配的租户
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={formOpen}
        title={editing ? "编辑租户" : "创建租户"}
        onClose={() => setFormOpen(false)}
        wide
        footer={
          <Button
            type="submit"
            form="tenant-form"
            disabled={saveMutation.isPending}
          >
            {editing ? "保存租户" : "创建租户"}
          </Button>
        }
      >
        <form id="tenant-form" className={ui.formGrid} onSubmit={onSubmit}>
          <Field label="租户名称" full>
            <Input
              variant="field"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </Field>
          <Field
            label="唯一标识"
            hint="小写字母、数字和短横线，创建后不可变"
          >
            <Input
              variant="field"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              pattern="[a-z0-9][a-z0-9-]{1,38}"
              placeholder="如 northstar"
              required
              readOnly={Boolean(editing)}
            />
          </Field>
          <Field label="所有者邮箱">
            <Input
              variant="field"
              type="email"
              value={form.ownerEmail}
              onChange={(e) =>
                setForm((f) => ({ ...f, ownerEmail: e.target.value }))
              }
              required={!editing}
              readOnly={Boolean(editing)}
            />
          </Field>
          <Field label="并发会话上限 / 用户">
            <Input
              variant="field"
              type="number"
              min={1}
              value={form.maxConcurrentSessionsPerUser}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  maxConcurrentSessionsPerUser: Number(e.target.value) || 1,
                }))
              }
            />
          </Field>
          <Field label="活跃工作区上限">
            <Input
              variant="field"
              type="number"
              min={1}
              value={form.maxActiveWorkspaces}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  maxActiveWorkspaces: Number(e.target.value) || 1,
                }))
              }
            />
          </Field>
          <Field label="每日 Token 配额（可选）" hint="留空表示不限">
            <Input
              variant="field"
              type="number"
              min={1}
              value={form.tokensPerDay}
              onChange={(e) =>
                setForm((f) => ({ ...f, tokensPerDay: e.target.value }))
              }
            />
          </Field>
        </form>
        <p className={ui.inlineNote}>
          创建后由 owner 管理租户内项目。配额可随时由平台管理员调整。
        </p>
      </Modal>

      <Modal
        open={Boolean(detail)}
        title={detail ? `${detail.name} · 租户详情` : "租户详情"}
        onClose={() => setDetail(null)}
        footer={
          detail ? (
            <>
              {detail.status === "active" &&
              membershipTenants.some((m) => m.id === detail.id) ? (
                <Button
                  onClick={() => {
                    void (async () => {
                      try {
                        if (detail.id !== tenantId) await switchTenant(detail.id);
                        setDetail(null);
                        navigate(`/t/${detail.id}/projects`);
                      } catch (err) {
                        toast(await getApiErrorMessage(err, "切换租户失败"));
                      }
                    })();
                  }}
                >
                  {detail.id === tenantId ? "查看项目" : "切换到此租户"}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirmStatus(detail);
                }}
              >
                {detail.status === "active" ? "停用租户" : "恢复租户"}
              </Button>
            </>
          ) : null
        }
      >
        {detail ? (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div>
                <small>组织标识</small>
                <strong className="mt-1 block text-[#344054]">{detail.slug}</strong>
              </div>
              <div>
                <small>状态</small>
                <div className="mt-1">
                  <Badge tone={detail.status === "active" ? "green" : "orange"}>
                    {detail.status === "active" ? "运行中" : "已停用"}
                  </Badge>
                </div>
              </div>
              <div>
                <small>所有者</small>
                <strong className="mt-1 block text-[#344054]">
                  {ownersQuery.data?.get(detail.id)?.displayName ?? "—"}
                </strong>
              </div>
              <div>
                <small>资源配额</small>
                <strong className="mt-1 block text-[#344054]">
                  {formatQuota(detail).primary} / {formatQuota(detail).secondary}
                </strong>
              </div>
            </div>
            <p className={ui.inlineNote}>
              停用租户会阻止项目访问和新会话；恢复后可重新进入。数据与工作区保留策略由服务端执行。
            </p>
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmStatus)}
        title={
          confirmStatus
            ? `${confirmStatus.status === "active" ? "停用租户" : "恢复"} · ${confirmStatus.name}`
            : ""
        }
        onClose={() => setConfirmStatus(null)}
        footer={
          confirmStatus ? (
            <Button
              variant={confirmStatus.status === "active" ? "danger" : "default"}
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate(confirmStatus)}
            >
              确认{confirmStatus.status === "active" ? "停用" : "恢复"}
            </Button>
          ) : null
        }
      >
        <p>
          {confirmStatus?.status === "active"
            ? "将阻止新的工作区访问和会话创建，现有数据保留。恢复后可重新进入。"
            : "恢复后可重新进入项目空间，活跃会话不会自动重启。"}
        </p>
      </Modal>
    </>
  );
}
