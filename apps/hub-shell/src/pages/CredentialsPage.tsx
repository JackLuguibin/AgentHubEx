import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectCredential, ProjectRole, UserCredential } from "@agenthub/domain";
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Field,
  Icon,
  Input,
  PageHeader,
  Select,
  Tabs,
  cn,
  ui,
} from "@agenthub/hub-ui-kit";
import { KeyRound, Plus, Shield } from "lucide-react";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";
import { Modal } from "../components/Modal.js";
import { api } from "../lib/api.js";
import { getApiErrorMessage } from "../lib/api-error.js";
import { useToast } from "../lib/toast.js";

type Tab = "project" | "personal";
type Provider = UserCredential["provider"];
type Editor =
  | { scope: Tab; mode: "create" }
  | { scope: Tab; mode: "edit" | "rotate"; id: string };

type FormState = {
  label: string;
  provider: Provider;
  baseUrl: string;
  defaultModel: string;
  secret: string;
  isDefault: boolean;
  allowedRoles: ProjectRole[];
};

const PROVIDERS: Provider[] = ["anthropic", "openai", "opencode", "custom"];
const ROLES: ProjectRole[] = ["owner", "developer", "viewer"];

const emptyForm = (): FormState => ({
  label: "",
  provider: "openai",
  baseUrl: "",
  defaultModel: "",
  secret: "",
  isDefault: false,
  allowedRoles: ["owner", "developer"],
});

function formFrom(row: UserCredential | ProjectCredential): FormState {
  const project = "isDefault" in row ? row : null;
  return {
    label: row.label,
    provider: row.provider,
    baseUrl: row.metadata.baseUrl ?? "",
    defaultModel: row.metadata.defaultModel ?? "",
    secret: "",
    isDefault: project?.isDefault ?? false,
    allowedRoles: project?.allowedRoles ?? ["owner", "developer"],
  };
}

function metadataOf(form: FormState) {
  const metadata: { baseUrl?: string; defaultModel?: string } = {};
  const baseUrl = form.baseUrl.trim();
  const model = form.defaultModel.trim();
  if (baseUrl) metadata.baseUrl = baseUrl;
  if (model) metadata.defaultModel = model;
  return metadata;
}

const POLICY_LABEL: Record<string, string> = {
  user_or_project: "个人与项目均可",
  project_only: "仅项目共享凭据",
  user_only: "仅个人凭据",
};

export function CredentialsPage() {
  const { user } = useAuth();
  const { tenantId, projectId, projects } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const project = projects.find((item) => item.id === projectId);
  const tenantRole = user?.tenants.find((item) => item.id === tenantId)?.role;
  const canManageProject =
    tenantRole === "owner" || tenantRole === "admin" || project?.myRole === "owner";

  const [tab, setTab] = useState<Tab>("project");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const personalQuery = useQuery({
    queryKey: ["user-credentials"],
    queryFn: async () => (await api.listUserCredentials()).items,
  });
  const projectQuery = useQuery({
    queryKey: ["project-credentials", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => (await api.listProjectCredentials(projectId!)).items,
  });

  const personal = personalQuery.data ?? [];
  const shared = projectQuery.data ?? [];
  const rows = tab === "personal" ? personal : shared;
  const loading = tab === "personal" ? personalQuery.isLoading : projectQuery.isLoading;
  const canWrite = tab === "personal" || canManageProject;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["user-credentials"] });
    await queryClient.invalidateQueries({ queryKey: ["project-credentials", projectId] });
    await queryClient.invalidateQueries({ queryKey: ["credential-options", projectId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!editor) return;
      const metadata = metadataOf(form);
      const secret = form.secret.trim();
      if (editor.mode === "create" && !secret) throw new Error("请填写密钥");
      if (editor.mode === "rotate" && !secret) throw new Error("轮换时必须填写新密钥");
      if (editor.scope === "personal") {
        if (editor.mode === "create") {
          return api.createUserCredential({
            provider: form.provider,
            label: form.label.trim(),
            secret,
            metadata,
          });
        }
        return api.patchUserCredential(editor.id, {
          provider: form.provider,
          label: form.label.trim(),
          metadata,
          ...(secret ? { secret, rotationMode: "graceful" as const } : {}),
        });
      }
      if (!projectId) throw new Error("请先选择项目");
      const projectFields = {
        provider: form.provider,
        label: form.label.trim(),
        metadata,
        isDefault: form.isDefault,
        allowedRoles: form.allowedRoles,
      };
      if (editor.mode === "create") {
        return api.createProjectCredential(projectId, { ...projectFields, secret });
      }
      return api.patchProjectCredential(projectId, editor.id, {
        ...projectFields,
        ...(secret ? { secret, rotationMode: "graceful" as const } : {}),
      });
    },
    onSuccess: async () => {
      setEditor(null);
      setForm(emptyForm());
      toast("凭据已保存。密钥不会再显示。");
      await refresh();
    },
    onError: async (err) => toast(err instanceof Error && err.message.startsWith("请") ? err.message : await getApiErrorMessage(err, "保存凭据失败")),
  });

  const toggle = useMutation({
    mutationFn: async (row: UserCredential | ProjectCredential) => {
      const status = row.status === "active" ? "disabled" : "active";
      if (tab === "personal") return api.patchUserCredential(row.id, { status });
      return api.patchProjectCredential(projectId!, row.id, { status });
    },
    onSuccess: async () => {
      toast("凭据状态已更新");
      await refresh();
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "更新凭据失败")),
  });

  const test = useMutation({
    mutationFn: async (id: string) => {
      if (tab === "personal") return api.testUserCredential(id);
      return api.testProjectCredential(projectId!, id);
    },
    onSuccess: (result) => {
      if (result.ok) toast(`已连通${result.latencyMs != null ? `，耗时 ${result.latencyMs} ms` : ""}`);
      else toast(result.error || "无法连接");
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "连通测试失败")),
  });

  const openCreate = () => {
    setForm(emptyForm());
    setEditor({ scope: tab, mode: "create" });
  };

  const openEdit = (row: UserCredential | ProjectCredential, mode: "edit" | "rotate") => {
    setForm(formFrom(row));
    setEditor({ scope: tab, mode, id: row.id });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.label.trim()) {
      toast("请填写名称");
      return;
    }
    save.mutate();
  };

  const policy = project?.credentialPolicy ?? "user_or_project";

  return (
    <>
      <PageHeader
        eyebrow="项目配置"
        title="凭据管理"
        description="按项目策略选择凭据，会话创建后锁定来源与版本。"
        actions={
          <Button disabled={!canWrite || (tab === "project" && !projectId)} onClick={openCreate}>
            <Icon icon={Plus} size="sm" />
            添加凭据
          </Button>
        }
      />

      <Tabs
        aria-label="凭据范围"
        value={tab}
        onChange={setTab}
        items={[
          { value: "project", label: "项目共享凭据" },
          { value: "personal", label: "我的个人凭据" },
        ]}
      />

      <Banner icon={Shield}>
        API Key 只在保存时提交，之后不能再查看明文。当前项目策略：{POLICY_LABEL[policy] ?? policy}。
      </Banner>

      <div className={cn(ui.surface, ui.tableWrap)}>
        <table className={ui.dataTable}>
          <thead>
            <tr>
              <th>名称</th>
              <th>Provider</th>
              <th>来源 / 权限</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className={ui.empty}>
                  加载中…
                </td>
              </tr>
            ) : null}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={5} className={ui.empty}>
                  {tab === "personal" ? "还没有个人凭据。" : "这个项目还没有共享凭据。"}
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const projectRow = tab === "project" ? (row as ProjectCredential) : null;
              return (
                <tr key={row.id}>
                  <td>
                    <strong className="inline-flex items-center gap-1">
                      <Icon icon={KeyRound} size="xs" />
                      {row.label}
                    </strong>{" "}
                    {projectRow?.isDefault ? <Badge tone="green">项目默认</Badge> : null}
                    <small>
                      末四位 {row.last4 ?? "—"} · v{row.version}
                    </small>
                  </td>
                  <td>
                    {row.provider}
                    <small>{row.metadata.baseUrl || "未填写 Base URL"}</small>
                  </td>
                  <td>
                    {tab === "personal"
                      ? "仅本人可管理"
                      : `可用角色：${projectRow?.allowedRoles.join("、") || "—"}`}
                  </td>
                  <td>
                    <Badge tone={row.status === "active" ? "green" : "default"}>
                      {row.status === "active" ? "有效" : row.status === "disabled" ? "已停用" : "已过期"}
                    </Badge>
                  </td>
                  <td className={ui.tableActions}>
                    <Button size="sm" variant="secondary" disabled={!canWrite || test.isPending} onClick={() => test.mutate(row.id)}>
                      测试
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!canWrite} onClick={() => openEdit(row, "edit")}>
                      配置
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!canWrite} onClick={() => openEdit(row, "rotate")}>
                      轮换
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!canWrite || toggle.isPending} onClick={() => toggle.mutate(row)}>
                      {row.status === "active" ? "停用" : "启用"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!canWrite ? (
        <EmptyState>只有项目所有者可以管理项目共享凭据。个人凭据在「我的个人凭据」里维护。</EmptyState>
      ) : null}

      <div className={ui.bottomGrid}>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>注入时机</h2>
            <Badge tone="green">会话锁定</Badge>
          </div>
          <p className={ui.inlineNote}>
            创建会话时选择凭据并锁定版本。运行中不读取最新密钥；轮换后需新建会话生效。
          </p>
        </div>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>安全边界</h2>
            <span className={ui.badge}>密文</span>
          </div>
          <p className={ui.inlineNote}>
            密钥经 Facade 注入运行时，不回传浏览器。列表只显示末四位。
          </p>
        </div>
      </div>

      <Modal
        open={editor != null}
        title={editor?.mode === "create" ? "添加凭据" : editor?.mode === "rotate" ? "轮换密钥" : "配置凭据"}
        onClose={() => setEditor(null)}
        wide
        footer={
          <Button type="submit" form="credential-form" disabled={save.isPending}>
            保存
          </Button>
        }
      >
        <form id="credential-form" className={ui.formGrid} onSubmit={onSubmit}>
          <Field label="名称" full>
            <Input
              variant="field"
              value={form.label}
              onChange={(e) => setForm((current) => ({ ...current, label: e.target.value }))}
              required
              autoComplete="off"
            />
          </Field>
          <Field label="Provider">
            <Select
              variant="field"
              value={form.provider}
              onChange={(e) => setForm((current) => ({ ...current, provider: e.target.value as Provider }))}
            >
              {PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="默认模型">
            <Input
              variant="field"
              value={form.defaultModel}
              onChange={(e) => setForm((current) => ({ ...current, defaultModel: e.target.value }))}
              autoComplete="off"
            />
          </Field>
          <Field label="Base URL" hint="以 http:// 或 https:// 开头。留空则不能做连通测试。" full>
            <Input
              variant="field"
              value={form.baseUrl}
              onChange={(e) => setForm((current) => ({ ...current, baseUrl: e.target.value }))}
              placeholder="https://"
              autoComplete="off"
            />
          </Field>
          <Field
            label={editor?.mode === "create" ? "密钥" : "新密钥"}
            hint={editor?.mode === "edit" ? "留空表示不轮换" : "只在这次提交时使用，不会保存在浏览器里"}
            full
          >
            <Input
              variant="field"
              type="password"
              value={form.secret}
              onChange={(e) => setForm((current) => ({ ...current, secret: e.target.value }))}
              autoComplete="new-password"
              required={editor?.mode !== "edit"}
            />
          </Field>
          {editor?.scope === "project" ? (
            <>
              <Field label="设为项目默认">
                <Select
                  variant="field"
                  value={form.isDefault ? "yes" : "no"}
                  onChange={(e) => setForm((current) => ({ ...current, isDefault: e.target.value === "yes" }))}
                >
                  <option value="no">否</option>
                  <option value="yes">是</option>
                </Select>
              </Field>
              <Field label="允许使用的角色" full>
                <div className="flex flex-wrap gap-3">
                  {ROLES.map((role) => (
                    <label key={role} className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={form.allowedRoles.includes(role)}
                        onChange={(e) =>
                          setForm((current) => ({
                            ...current,
                            allowedRoles: e.target.checked
                              ? [...current.allowedRoles, role]
                              : current.allowedRoles.filter((item) => item !== role),
                          }))
                        }
                      />
                      {role}
                    </label>
                  ))}
                </div>
              </Field>
            </>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
