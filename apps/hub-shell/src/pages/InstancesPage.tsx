import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RuntimeInstance, TestInstanceRes, Workspace } from "@agenthub/domain";
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
  cn,
  ui,
  type BadgeTone,
} from "@agenthub/hub-ui-kit";
import { Circle, Info, Plus } from "lucide-react";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";
import { Modal } from "../components/Modal.js";
import { api } from "../lib/api.js";
import { getApiErrorMessage } from "../lib/api-error.js";
import { useToast } from "../lib/toast.js";

const HEALTH_LABEL: Record<RuntimeInstance["health"], { text: string; tone: BadgeTone }> = {
  healthy: { text: "健康", tone: "green" },
  degraded: { text: "降级", tone: "orange" },
  unhealthy: { text: "离线", tone: "red" },
  pending: { text: "待检测", tone: "default" },
  disabled: { text: "已停用", tone: "default" },
};

type RegisterForm = {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  isolation: "dedicated" | "shared";
  labels: string;
  projectIds: string[];
};

const emptyForm = (projectId: string | null): RegisterForm => ({
  name: "",
  baseUrl: "http://",
  username: "",
  password: "",
  isolation: "dedicated",
  labels: "",
  projectIds: projectId ? [projectId] : [],
});

function parseLabels(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(",")) {
    const [k, ...rest] = part.split("=");
    const key = k?.trim();
    if (key) out[key] = rest.join("=").trim();
  }
  return out;
}

function formatLatency(i: RuntimeInstance) {
  return i.latencyMs != null && i.health !== "unhealthy" ? `${i.latencyMs} ms` : "—";
}

export function InstancesPage() {
  const { user } = useAuth();
  const { tenantId, projectId, projects } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const tenantRole = user?.tenants.find((t) => t.id === tenantId)?.role;
  const currentProject = projects.find((p) => p.id === projectId) ?? null;
  const canManageInstances =
    Boolean(user?.isPlatformAdmin) || tenantRole === "owner" || tenantRole === "admin";
  const canManageBinding = canManageInstances || currentProject?.myRole === "owner";
  const canUseWorkspace = currentProject?.myRole != null && currentProject.myRole !== "viewer";

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<RegisterForm>(() => emptyForm(projectId));
  const [testResult, setTestResult] = useState<TestInstanceRes | null>(null);
  const [detail, setDetail] = useState<RuntimeInstance | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RuntimeInstance | null>(null);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingDraft, setBindingDraft] = useState<string[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [fileCheck, setFileCheck] = useState<string | null>(null);

  const instancesQuery = useQuery({
    queryKey: ["instances", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => (await api.listInstances(tenantId!)).items,
  });

  const bindingsQuery = useQuery({
    queryKey: ["project-bindings", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => (await api.getProjectBindings(projectId!)).bindings,
  });

  const instances = useMemo(() => instancesQuery.data ?? [], [instancesQuery.data]);
  const bindings = bindingsQuery.data ?? [];
  const instanceName = (id?: string) =>
    instances.find((i) => i.id === id)?.name ?? "（已删除实例）";

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["instances", tenantId] }),
      queryClient.invalidateQueries({ queryKey: ["project-bindings"] }),
    ]);
  };

  const connectionInput = () => ({
    runtimeType: "opencode" as const,
    baseUrl: form.baseUrl.trim(),
    auth: form.username.trim()
      ? { username: form.username.trim(), password: form.password }
      : undefined,
  });

  const testMutation = useMutation({
    mutationFn: async () => api.testInstance(tenantId!, connectionInput()),
    onSuccess: (res) => setTestResult(res),
    onError: async (err) => toast(await getApiErrorMessage(err, "连接测试失败")),
  });

  const registerMutation = useMutation({
    mutationFn: async () =>
      api.registerInstance(tenantId!, {
        ...connectionInput(),
        name: form.name.trim(),
        isolation: form.isolation,
        labels: parseLabels(form.labels),
        assignedProjectIds: form.projectIds,
      }),
    onSuccess: async (inst) => {
      setFormOpen(false);
      await refresh();
      toast(
        inst.health === "healthy"
          ? `实例 ${inst.name} 已登记，测活通过`
          : `实例 ${inst.name} 已登记，但测活未通过，请检查地址与认证`,
      );
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "登记实例失败")),
  });

  const probeMutation = useMutation({
    mutationFn: async (id: string) => api.probeInstance(id),
    onSuccess: async (inst) => {
      await refresh();
      toast(`${inst.name}：${HEALTH_LABEL[inst.health].text}`);
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "检测失败")),
  });

  const toggleMutation = useMutation({
    mutationFn: async (inst: RuntimeInstance) =>
      api.patchInstance(inst.id, { enabled: inst.health === "disabled" }),
    onSuccess: async (inst) => {
      setDetail(null);
      await refresh();
      toast(inst.health === "disabled" ? "实例已停用" : "实例已启用，等待下次检测");
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "更新实例失败")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.deleteInstance(id),
    onSuccess: async () => {
      setConfirmDelete(null);
      setDetail(null);
      await refresh();
      toast("实例已删除");
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "删除实例失败")),
  });

  const saveBindingsMutation = useMutation({
    mutationFn: async () =>
      api.putProjectBindings(projectId!, {
        bindings: bindingDraft.map((instanceId, idx) => ({
          runtimeType: "opencode" as const,
          instanceId,
          priority: (idx + 1) * 10,
        })),
      }),
    onSuccess: async () => {
      setBindingOpen(false);
      await refresh();
      toast("项目实例绑定已保存");
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "保存绑定失败")),
  });

  const workspaceMutation = useMutation({
    mutationFn: async () => {
      const ws = await api.getWorkspaceMe(projectId!);
      let files: string | null = null;
      if (ws.status === "ready" || ws.status === "ready_degraded") {
        const listing = await api.agentGet<unknown>(ws.id, "file?path=/");
        const count = Array.isArray(listing)
          ? listing.length
          : Array.isArray((listing as { entries?: unknown[] })?.entries)
            ? (listing as { entries: unknown[] }).entries.length
            : 0;
        files = `文件通道正常 · 根目录 ${count} 项`;
      }
      return { ws, files };
    },
    onSuccess: ({ ws, files }) => {
      setWorkspace(ws);
      setFileCheck(files);
    },
    onError: async (err) => {
      setWorkspace(null);
      setFileCheck(null);
      toast(await getApiErrorMessage(err, "工作区不可用"));
    },
  });

  const openRegister = () => {
    setForm(emptyForm(projectId));
    setTestResult(null);
    setFormOpen(true);
  };

  const openBindings = () => {
    setBindingDraft(bindings.flatMap((b) => (b.instanceId ? [b.instanceId] : [])));
    setBindingOpen(true);
  };

  const onRegister = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast("请输入实例名称");
      return;
    }
    registerMutation.mutate();
  };

  const toggleProject = (id: string, checked: boolean) =>
    setForm((f) => ({
      ...f,
      projectIds: checked ? [...f.projectIds, id] : f.projectIds.filter((p) => p !== id),
    }));

  return (
    <>
      <PageHeader
        eyebrow="工作空间"
        title="运行实例"
        description="集中登记与管理运行时，通过 Hub 安全连接你的个人工作区。"
        actions={
          canManageInstances ? (
            <Button onClick={openRegister} disabled={!tenantId}>
              <Icon icon={Plus} size="sm" />
              登记远程实例
            </Button>
          ) : null
        }
      />

      <Banner icon={Info}>
        dedicated 实例同一时刻只服务一个成员的工作区；节点地址与认证由控制平面加密保存，成员只经 Hub
        访问，浏览器不会拿到节点地址或密码。
      </Banner>

      {instancesQuery.isLoading ? (
        <EmptyState surface>加载实例…</EmptyState>
      ) : instances.length === 0 ? (
        <EmptyState surface>
          当前租户还没有登记运行实例。
          <br />
          {canManageInstances
            ? "点击「登记远程实例」接入已运行的 opencode serve。"
            : "请联系租户管理员登记实例。"}
        </EmptyState>
      ) : (
        <div className={cn(ui.surface, ui.tableWrap)}>
          <table className={ui.dataTable}>
            <thead>
              <tr>
                <th>实例 / 引擎</th>
                <th>隔离</th>
                <th>项目 / 工作区</th>
                <th>健康状态</th>
                <th>延迟</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((inst) => {
                const health = HEALTH_LABEL[inst.health];
                return (
                  <tr key={inst.id}>
                    <td>
                      <strong>{inst.name}</strong>
                      <small>
                        OpenCode · {inst.mode}
                        {inst.upstreamVersion ? ` · v${inst.upstreamVersion}` : ""}
                      </small>
                    </td>
                    <td>
                      <Badge tone={inst.isolation === "dedicated" ? "green" : "orange"}>
                        {inst.isolation}
                      </Badge>
                    </td>
                    <td>
                      {inst.boundProjectCount ?? 0} 个项目绑定
                      <small>{inst.workspaceCount ?? 0} 个工作区</small>
                    </td>
                    <td>
                      <Badge tone={health.tone} className="inline-flex items-center gap-1">
                        <Icon icon={Circle} size="xs" className="fill-current" />
                        {health.text}
                      </Badge>
                    </td>
                    <td>{formatLatency(inst)}</td>
                    <td className={ui.tableActions}>
                      {canManageInstances ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={inst.health === "disabled" || probeMutation.isPending}
                          onClick={() => probeMutation.mutate(inst.id)}
                        >
                          检测
                        </Button>
                      ) : null}
                      <Button size="sm" variant="secondary" onClick={() => setDetail(inst)}>
                        详情
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={ui.bottomGrid}>
        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>项目实例绑定</h2>
            <span className={ui.badge}>{currentProject?.key ?? "未选择项目"}</span>
          </div>
          {bindings.length === 0 ? (
            <p className={ui.inlineNote}>
              当前项目没有显式绑定；会使用分配给本项目或未分配的实例。
            </p>
          ) : (
            <ul className="m-0 mb-2 list-none p-0 text-[11px] text-[#475467]">
              {bindings.map((b) => (
                <li key={b.id} className="py-1">
                  {b.instanceId ? instanceName(b.instanceId) : "按标签选择"}
                  <span className="ml-2 text-[10px] text-[#98a2b3]">优先级 {b.priority}</span>
                </li>
              ))}
            </ul>
          )}
          {canManageBinding && projectId ? (
            <Button size="sm" variant="secondary" onClick={openBindings}>
              管理绑定
            </Button>
          ) : null}
        </div>

        <div className={cn(ui.surface, ui.panel)}>
          <div className={ui.panelTitle}>
            <h2 className={ui.panelTitleH2}>我的工作区连接</h2>
            <span className={ui.badge}>Facade</span>
          </div>
          {workspace ? (
            <p className={ui.inlineNote}>
              状态 {workspace.status}
              {workspace.instance
                ? ` · 实例 ${workspace.instance.name}（${HEALTH_LABEL[workspace.instance.health].text}）`
                : ""}
              {workspace.statusReason ? ` · ${workspace.statusReason}` : ""}
              {fileCheck ? (
                <>
                  <br />
                  {fileCheck}
                </>
              ) : null}
            </p>
          ) : (
            <p className={ui.inlineNote}>
              经 Hub 获取个人工作区并读取文件根目录，验证白名单反代链路。
            </p>
          )}
          {canUseWorkspace && projectId ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={workspaceMutation.isPending}
              onClick={() => workspaceMutation.mutate()}
            >
              {workspaceMutation.isPending ? "检查中…" : "检查连接"}
            </Button>
          ) : null}
        </div>
      </div>

      <Modal
        open={formOpen}
        title="登记远程 OpenCode 实例"
        wide
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={testMutation.isPending || !form.baseUrl.trim()}
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending ? "测试中…" : "测试连接"}
            </Button>
            <Button type="submit" form="register-instance-form" disabled={registerMutation.isPending}>
              {registerMutation.isPending ? "登记中…" : "登记并验证"}
            </Button>
          </>
        }
      >
        <form id="register-instance-form" className={ui.formGrid} onSubmit={onRegister}>
          <Field label="实例名称" full>
            <Input
              variant="field"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="如 oc-dev-01"
            />
          </Field>
          <Field label="服务 URL" full hint="opencode serve 监听地址，仅保存在控制平面">
            <Input
              variant="field"
              type="url"
              required
              value={form.baseUrl}
              onChange={(e) => {
                setTestResult(null);
                setForm((f) => ({ ...f, baseUrl: e.target.value }));
              }}
            />
          </Field>
          <Field label="节点认证用户名">
            <Input
              variant="field"
              autoComplete="off"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
          </Field>
          <Field label="节点认证密码 / Token">
            <Input
              variant="field"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </Field>
          <Field label="隔离方式" hint="内网交付档禁止新建 shared">
            <Select
              variant="field"
              value={form.isolation}
              onChange={(e) =>
                setForm((f) => ({ ...f, isolation: e.target.value as RegisterForm["isolation"] }))
              }
            >
              <option value="dedicated">dedicated（推荐，一人一进程）</option>
              <option value="shared">shared（仅演示）</option>
            </Select>
          </Field>
          <Field label="节点标签" hint="逗号分隔，如 env=dev,zone=a">
            <Input
              variant="field"
              value={form.labels}
              onChange={(e) => setForm((f) => ({ ...f, labels: e.target.value }))}
            />
          </Field>
          <Field label="分配并绑定到项目" full>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[#475467]">
              {projects.length === 0 ? (
                <span>当前租户暂无可用项目</span>
              ) : (
                projects.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={form.projectIds.includes(p.id)}
                      onChange={(e) => toggleProject(p.id, e.target.checked)}
                    />
                    {p.name}
                    <small className="text-[10px] text-[#98a2b3]">{p.key}</small>
                  </label>
                ))
              )}
            </div>
          </Field>
          {testResult ? (
            <p
              className={cn(
                "col-span-full m-0 text-[11px]",
                testResult.ok ? "text-ah-green" : "text-[#b42318]",
              )}
            >
              {testResult.ok
                ? `连接成功${testResult.latencyMs != null ? ` · ${testResult.latencyMs} ms` : ""}`
                : `连接失败：${testResult.error ?? "上游不可达"}`}
            </p>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        title="实例详情"
        onClose={() => setDetail(null)}
        footer={
          detail && canManageInstances ? (
            <>
              <Button
                variant="secondary"
                disabled={toggleMutation.isPending}
                onClick={() => toggleMutation.mutate(detail)}
              >
                {detail.health === "disabled" ? "启用" : "停用"}
              </Button>
              <Button variant="danger" onClick={() => setConfirmDelete(detail)}>
                删除
              </Button>
            </>
          ) : undefined
        }
      >
        {detail ? (
          <dl className="m-0 grid grid-cols-[96px_1fr] gap-y-2 text-[11px]">
            <dt>名称</dt>
            <dd className="m-0 text-[#344054]">{detail.name}</dd>
            {detail.baseUrl ? (
              <>
                <dt>服务 URL</dt>
                <dd className="m-0 font-mono text-[#344054]">{detail.baseUrl}</dd>
              </>
            ) : null}
            <dt>隔离</dt>
            <dd className="m-0 text-[#344054]">{detail.isolation}</dd>
            <dt>健康</dt>
            <dd className="m-0 text-[#344054]">
              {HEALTH_LABEL[detail.health].text} · {formatLatency(detail)}
            </dd>
            <dt>最近检测</dt>
            <dd className="m-0 text-[#344054]">
              {detail.lastCheckedAt ? new Date(detail.lastCheckedAt).toLocaleString() : "—"}
            </dd>
            <dt>分配项目</dt>
            <dd className="m-0 text-[#344054]">
              {detail.assignedProjectIds.length === 0
                ? "未分配（租户内可用）"
                : detail.assignedProjectIds
                    .map((id) => projects.find((p) => p.id === id)?.name ?? id.slice(0, 8))
                    .join("、")}
            </dd>
            <dt>标签</dt>
            <dd className="m-0 text-[#344054]">
              {Object.entries(detail.labels)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ") || "—"}
            </dd>
          </dl>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        title="删除实例"
        onClose={() => setConfirmDelete(null)}
        footer={
          <Button
            variant="danger"
            disabled={deleteMutation.isPending}
            onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
          >
            确认删除
          </Button>
        }
      >
        确认删除实例 <strong>{confirmDelete?.name}</strong>？仍有工作区在使用时将被拒绝。
      </Modal>

      <Modal
        open={bindingOpen}
        title={`项目实例绑定 · ${currentProject?.name ?? ""}`}
        onClose={() => setBindingOpen(false)}
        footer={
          <Button
            disabled={saveBindingsMutation.isPending}
            onClick={() => saveBindingsMutation.mutate()}
          >
            保存绑定
          </Button>
        }
      >
        <p className="m-0 mb-3">勾选顺序即调度优先级；dedicated 实例被其他成员占用时会跳过。</p>
        <div className="grid gap-2">
          {instances
            .filter((i) => i.runtimeType === "opencode")
            .map((inst) => (
              <label key={inst.id} className="flex items-center gap-2 text-[11px] text-[#475467]">
                <input
                  type="checkbox"
                  checked={bindingDraft.includes(inst.id)}
                  onChange={(e) =>
                    setBindingDraft((d) =>
                      e.target.checked ? [...d, inst.id] : d.filter((x) => x !== inst.id),
                    )
                  }
                />
                {inst.name}
                <Badge tone={HEALTH_LABEL[inst.health].tone}>
                  {HEALTH_LABEL[inst.health].text}
                </Badge>
                <span className="text-[10px] text-[#98a2b3]">{inst.isolation}</span>
              </label>
            ))}
        </div>
      </Modal>
    </>
  );
}
