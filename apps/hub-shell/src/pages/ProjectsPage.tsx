import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
import type { Project } from "@agenthub/domain";
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

type CredentialPolicy = Project["credentialPolicy"];

const POLICY_LABEL: Record<CredentialPolicy, string> = {
  user_or_project: "个人或项目",
  project_only: "仅项目",
  user_only: "仅个人",
};

type ProjectFormState = {
  name: string;
  key: string;
  description: string;
  credentialPolicy: CredentialPolicy;
  defaultRuntimeType: "opencode" | "claude";
};

const emptyForm = (): ProjectFormState => ({
  name: "",
  key: "",
  description: "",
  credentialPolicy: "user_or_project",
  defaultRuntimeType: "opencode",
});

function canManage(p: Project, tenantRole: string | undefined, isPlatformAdmin: boolean) {
  if (isPlatformAdmin) return true;
  if (tenantRole === "owner" || tenantRole === "admin") return true;
  return p.myRole === "owner";
}

export function ProjectsPage() {
  const { user } = useAuth();
  const {
    tenantId,
    allProjects,
    projectId,
    setProjectId,
    loadingProjects,
    refreshProjects,
    switchTenant,
  } = useTenant();
  const params = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const routeTenantId = params.tenantId;
  const switchedForRoute = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">(
    "all",
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState<ProjectFormState>(emptyForm);
  const [detail, setDetail] = useState<Project | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<Project | null>(null);

  // Align URL tenant with context when visiting /t/:tenantId/projects
  useEffect(() => {
    if (!routeTenantId || routeTenantId === tenantId) {
      switchedForRoute.current = null;
      return;
    }
    if (switchedForRoute.current === routeTenantId) return;
    switchedForRoute.current = routeTenantId;
    void switchTenant(routeTenantId).catch(async (err) => {
      toast(await getApiErrorMessage(err, "无法切换到该租户"));
      navigate("/projects", { replace: true });
    });
  }, [routeTenantId, tenantId, switchTenant, toast, navigate]);

  const tenantMeta = user?.tenants.find((t) => t.id === tenantId);
  const tenantName = tenantMeta?.name ?? "当前租户";
  const tenantRole = tenantMeta?.role;
  const tenantActive = tenantMeta?.status === "active";
  const canCreate =
    Boolean(user?.isPlatformAdmin) ||
    tenantRole === "owner" ||
    tenantRole === "admin";

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allProjects.filter((p) => {
      const archived = p.archivedAt != null;
      if (statusFilter === "active" && archived) return false;
      if (statusFilter === "archived" && !archived) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [allProjects, query, statusFilter]);

  const activeCount = allProjects.filter((p) => p.archivedAt == null).length;
  const archivedCount = allProjects.filter((p) => p.archivedAt != null).length;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("未选择租户");
      if (editing) {
        return api.patchProject(editing.id, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          credentialPolicy: form.credentialPolicy,
          settings: { defaultRuntimeType: form.defaultRuntimeType },
        });
      }
      return api.createProject(tenantId, {
        key: form.key.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        credentialPolicy: form.credentialPolicy,
        settings: { defaultRuntimeType: form.defaultRuntimeType },
      });
    },
    onSuccess: async () => {
      toast(editing ? "项目已更新" : "项目已创建");
      setFormOpen(false);
      setEditing(null);
      await refreshProjects();
    },
    onError: async (err) => {
      toast(await getApiErrorMessage(err, "保存项目失败"));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (p: Project) => {
      if (p.archivedAt) return api.unarchiveProject(p.id);
      return api.archiveProject(p.id);
    },
    onSuccess: async (updated) => {
      toast(updated.archivedAt ? "项目已归档" : "项目已恢复");
      setConfirmArchive(null);
      setDetail(null);
      if (updated.archivedAt && updated.id === projectId) {
        setProjectId(null);
        navigate(tenantId ? `/t/${tenantId}/projects` : "/projects");
      }
      await refreshProjects();
    },
    onError: async (err) => {
      toast(await getApiErrorMessage(err, "更新项目状态失败"));
    },
  });

  const openCreate = () => {
    if (!tenantActive) {
      toast("请先启用当前租户");
      return;
    }
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditing(p);
    setForm({
      name: p.name,
      key: p.key,
      description: p.description ?? "",
      credentialPolicy: p.credentialPolicy,
      defaultRuntimeType: p.settings.defaultRuntimeType ?? "opencode",
    });
    setFormOpen(true);
  };

  const enterProject = (p: Project, page = "overview") => {
    if (p.archivedAt || !tenantActive || p.myRole == null) {
      toast("租户或项目不可用，或当前账号尚未绑定此空间");
      return;
    }
    setProjectId(p.id);
    setDetail(null);
    navigate(`/p/${p.id}/${page}`);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast("请输入项目名称");
      return;
    }
    if (!editing && !/^[A-Z][A-Z0-9]{1,9}$/.test(form.key.trim().toUpperCase())) {
      toast("项目标识格式不正确（如 AH、API）");
      return;
    }
    saveMutation.mutate();
  };

  return (
    <>
      <PageHeader
        eyebrow={`ORGANIZATION / ${tenantName.toUpperCase()}`}
        title="项目管理"
        description="按租户组织项目，配置成员、运行实例池和默认策略。"
        actions={
          canCreate ? (
            <>
              <Button
                variant="secondary"
                disabled={!projectId}
                title={projectId ? "打开成员与归属" : "请先选择项目"}
                onClick={() => {
                  if (projectId) navigate(`/p/${projectId}/members?view=users`);
                }}
              >
                用户与归属
              </Button>
              <Button onClick={openCreate} disabled={!tenantActive}>
                <Icon icon={Plus} size="sm" />
                新建项目
              </Button>
            </>
          ) : null
        }
      />

      <StatGrid>
        <Stat label="当前租户项目" value={allProjects.length} note={tenantName} />
        <Stat label="进行中" value={activeCount} note="可创建个人工作区" />
        <Stat label="已归档" value={archivedCount} note="保留资料与历史记录" />
        <Stat
          label="租户角色"
          value={
            <span className="text-lg tracking-normal">
              {tenantRole ?? "未绑定"}
            </span>
          }
          note="项目角色分别配置"
        />
      </StatGrid>

      <div className={cn(ui.surface, ui.managementGuidance)}>
        <div>
          <strong>项目归属与隔离</strong>
          <p>
            项目仅在所属租户内可见。进入项目时切换独立数据上下文，个人凭据随用户保留。
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => navigate("/tenants")}
        >
          租户详情
        </Button>
      </div>

      {!tenantActive && tenantId ? (
        <Banner icon={Info}>
          当前租户已停用，无法创建或进入项目。请在租户管理中恢复后再操作。
        </Banner>
      ) : null}

      <FilterToolbar count={`${list.length} 个项目`}>
        <label>
          <span className={ui.srOnly}>搜索项目</span>
          <Input
            variant="filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称或项目标识"
          />
        </label>
        <Select
          aria-label="项目状态"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "all" | "active" | "archived")
          }
        >
          <option value="all">全部状态</option>
          <option value="active">进行中</option>
          <option value="archived">已归档</option>
        </Select>
      </FilterToolbar>

      {loadingProjects ? (
        <EmptyState surface>加载项目…</EmptyState>
      ) : list.length === 0 ? (
        <EmptyState surface>
          当前租户下暂无匹配项目。
          <br />
          {canCreate
            ? "可点击「新建项目」创建，或调整筛选条件。"
            : "请联系租户管理员创建项目后再进入工作台。"}
        </EmptyState>
      ) : (
        <div className={cn(ui.surface, ui.tableWrap)}>
          <table className={ui.dataTable}>
            <thead>
              <tr>
                <th>项目 / 标识</th>
                <th>负责人 / 成员</th>
                <th>运行与配置</th>
                <th>凭据策略</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const archived = p.archivedAt != null;
                const engine = p.settings.defaultRuntimeType ?? "opencode";
                return (
                  <tr key={p.id}>
                    <td>
                      <strong className="inline-flex items-center gap-1">
                        <Icon icon={FolderKanban} size="xs" />
                        {p.name}
                      </strong>
                      {p.id === projectId ? (
                        <Badge tone="green">当前项目</Badge>
                      ) : null}
                      <small>
                        {p.key}
                        {p.description ? ` · ${p.description}` : ""}
                      </small>
                    </td>
                    <td>
                      {p.myRole ?? "—"}
                      <small>我的角色</small>
                    </td>
                    <td>
                      {engine === "opencode" ? "OpenCode" : "Claude"} · external
                      <small>实例池 · Bundle 后续接入</small>
                    </td>
                    <td>
                      <span className={ui.badge}>
                        {POLICY_LABEL[p.credentialPolicy]}
                      </span>
                    </td>
                    <td>
                      <Badge tone={archived ? "default" : "green"}>
                        {archived ? "已归档" : "进行中"}
                      </Badge>
                    </td>
                    <td className={ui.tableActions}>
                      {!archived && p.myRole != null && tenantActive ? (
                        <button
                          type="button"
                          className={ui.textLink}
                          style={{ color: "var(--accent)", cursor: "pointer" }}
                          onClick={() => enterProject(p)}
                        >
                          进入
                        </button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setDetail(p)}
                      >
                        管理
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={formOpen}
        title={editing ? "编辑项目" : "创建项目"}
        onClose={() => setFormOpen(false)}
        wide
        footer={
          <Button
            type="submit"
            form="project-form"
            disabled={saveMutation.isPending}
          >
            {editing ? "保存项目" : "创建项目"}
          </Button>
        }
      >
        <Banner icon={Info}>
          归属租户：{tenantName} · 项目不跨租户移动
        </Banner>
        <form
          id="project-form"
          className={cn(ui.formGrid, "mt-3")}
          onSubmit={onSubmit}
        >
          <Field label="项目名称" full>
            <Input
              variant="field"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </Field>
          <Field label="项目标识" hint="用于问题编号，在租户内唯一">
            <Input
              variant="field"
              value={form.key}
              onChange={(e) =>
                setForm((f) => ({ ...f, key: e.target.value.toUpperCase() }))
              }
              pattern="[A-Z][A-Z0-9]{1,9}"
              placeholder="如 API"
              required
              readOnly={Boolean(editing)}
            />
          </Field>
          <Field label="运行引擎" hint="选 Claude 时，工作台会隐藏文件树和终端。">
            <Select
              variant="field"
              value={form.defaultRuntimeType}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  defaultRuntimeType: e.target.value as "opencode" | "claude",
                }))
              }
            >
              <option value="opencode">OpenCode</option>
              <option value="claude">Claude</option>
            </Select>
          </Field>
          <Field label="凭据策略" full>
            <Select
              variant="field"
              value={form.credentialPolicy}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  credentialPolicy: e.target.value as CredentialPolicy,
                }))
              }
            >
              <option value="user_or_project">个人与项目凭据均可</option>
              <option value="project_only">仅项目共享凭据</option>
              <option value="user_only">仅用户个人凭据</option>
            </Select>
          </Field>
          <Field label="项目说明" full>
            <textarea
              className={cn(ui.fieldControl, ui.fieldTextarea)}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              rows={3}
            />
          </Field>
        </form>
        <p className={ui.inlineNote}>
          创建后进入独立项目空间，绑定实例和凭据后再开启个人会话。
        </p>
      </Modal>

      <Modal
        open={Boolean(detail)}
        title={detail ? `${detail.name} · 项目管理` : "项目管理"}
        onClose={() => setDetail(null)}
        wide
        footer={
          detail ? (
            <>
              {canManage(detail, tenantRole, Boolean(user?.isPlatformAdmin)) &&
              !detail.archivedAt ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    openEdit(detail);
                    setDetail(null);
                  }}
                >
                  编辑项目
                </Button>
              ) : null}
              {!detail.archivedAt && detail.myRole != null && tenantActive ? (
                <Button onClick={() => enterProject(detail)}>进入项目</Button>
              ) : null}
              {canManage(detail, tenantRole, Boolean(user?.isPlatformAdmin)) ? (
                <Button
                  variant="secondary"
                  onClick={() => setConfirmArchive(detail)}
                >
                  {detail.archivedAt ? "恢复项目" : "归档项目"}
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {detail ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <small>项目归属</small>
                <strong className="mt-1 block text-[#344054]">{tenantName}</strong>
              </div>
              <div>
                <small>项目标识</small>
                <strong className="mt-1 block text-[#344054]">{detail.key}</strong>
              </div>
              <div>
                <small>我的角色</small>
                <strong className="mt-1 block text-[#344054]">
                  {detail.myRole ?? "—"}
                </strong>
              </div>
              <div>
                <small>运行方式</small>
                <strong className="mt-1 block text-[#344054]">
                  {(detail.settings.defaultRuntimeType ?? "opencode") === "opencode"
                    ? "OpenCode"
                    : "Claude"}{" "}
                  / external
                </strong>
              </div>
            </div>
            {detail.description ? <p>{detail.description}</p> : null}
            <h3 className="mb-2 mt-4 text-xs font-semibold text-[#344054]">
              项目配置入口
            </h3>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["成员与角色", "members"],
                  ["实例绑定", "instances"],
                  ["配置 Bundle", "config"],
                  ["共享凭据", "credentials"],
                  ["公共文件", "files"],
                  ["项目策略", "settings"],
                ] as const
              ).map(([label, page]) => (
                <Button
                  key={page}
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(detail.archivedAt)}
                  onClick={() => enterProject(detail, page)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className={ui.inlineNote}>
              归档项目将停用工作区入口并停止活跃会话，资料保留。管理员可恢复项目。
            </p>
            {!detail.archivedAt ? (
              <p className="mt-2">
                <Link
                  className={ui.textLink}
                  style={{ color: "var(--accent)" }}
                  to={`/p/${detail.id}/overview`}
                  onClick={() => setProjectId(detail.id)}
                >
                  打开概览 →
                </Link>
              </p>
            ) : null}
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmArchive)}
        title={
          confirmArchive
            ? `${confirmArchive.archivedAt ? "恢复" : "归档项目"} · ${confirmArchive.name}`
            : ""
        }
        onClose={() => setConfirmArchive(null)}
        footer={
          confirmArchive ? (
            <Button
              variant={confirmArchive.archivedAt ? "default" : "danger"}
              disabled={archiveMutation.isPending}
              onClick={() => archiveMutation.mutate(confirmArchive)}
            >
              确认{confirmArchive.archivedAt ? "恢复" : "归档"}
            </Button>
          ) : null
        }
      >
        <p>
          {confirmArchive?.archivedAt
            ? "恢复后可重新进入项目空间，活跃会话不会自动重启。"
            : "将阻止新的工作区访问和会话创建，现有数据保留。恢复后可重新进入。"}
        </p>
      </Modal>
    </>
  );
}
