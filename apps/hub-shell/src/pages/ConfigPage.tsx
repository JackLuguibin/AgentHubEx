import { useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApplyJob, Bundle, Manifest } from "@agenthub/domain";
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
  type BadgeTone,
} from "@agenthub/hub-ui-kit";
import { Check, Command, FileStack, Hammer, Info, Plus, Sparkles, Zap } from "lucide-react";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";
import { Modal } from "../components/Modal.js";
import { api } from "../lib/api.js";
import { getApiErrorMessage } from "../lib/api-error.js";
import { useToast } from "../lib/toast.js";

const TABS = ["Agent", "MCP", "Skill", "AGENTS.md", "权限与模型", "下发记录"] as const;
type Tab = (typeof TABS)[number];

const STATUS_LABEL: Record<ApplyJob["status"], { text: string; tone: BadgeTone }> = {
  queued: { text: "排队", tone: "default" },
  running: { text: "进行中", tone: "orange" },
  succeeded: { text: "成功", tone: "green" },
  partial: { text: "部分成功", tone: "orange" },
  failed: { text: "失败", tone: "red" },
  skipped: { text: "跳过", tone: "default" },
  cancelled: { text: "已取消", tone: "default" },
};

const TRIGGER_LABEL: Record<ApplyJob["trigger"], string> = {
  publish: "发布自动同步",
  rollback: "回滚",
  manual: "手动下发",
  workspace_ready: "工作区就绪",
  schedule: "定时",
};

const KIND_LABEL: Record<ApplyJob["kind"], string> = {
  config: "配置",
  common: "公共空间",
  git_seed: "仓库",
};

const emptyManifest = (): Manifest => ({
  agents: [],
  mcp: [],
  skills: [],
  instructions: {},
});

export function ConfigPage() {
  const { projectId = "" } = useParams();
  const { projects } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const project = projects.find((item) => item.id === projectId) ?? null;
  const tenantRole = user?.tenants.find((item) => item.id === project?.tenantId)?.role;
  const canManage =
    Boolean(user?.isPlatformAdmin) ||
    tenantRole === "owner" ||
    tenantRole === "admin" ||
    project?.myRole === "owner";

  const [tab, setTab] = useState<Tab>("Agent");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editor, setEditor] = useState<
    | { kind: "agent"; index: number | null }
    | { kind: "mcp"; index: number | null }
    | { kind: "skill" }
    | null
  >(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const bundlesQuery = useQuery({
    queryKey: ["bundles", projectId],
    enabled: Boolean(projectId),
    queryFn: () => api.listProjectBundles(projectId),
  });
  const bundle: Bundle | undefined = bundlesQuery.data?.items[0];
  const draft = bundle?.draft ?? emptyManifest();

  const jobsQuery = useQuery({
    queryKey: ["apply-jobs", projectId],
    enabled: Boolean(projectId) && tab === "下发记录",
    queryFn: () => api.listApplyJobs(projectId),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((job) => job.status === "queued" || job.status === "running") ? 2000 : false;
    },
  });
  const lockQuery = useQuery({
    queryKey: ["config-lock", projectId],
    enabled: Boolean(projectId) && tab === "权限与模型",
    queryFn: () => api.getConfigLock(projectId),
  });
  const revisionsQuery = useQuery({
    queryKey: ["revisions", bundle?.id],
    enabled: Boolean(bundle?.id) && historyOpen,
    queryFn: () => api.listBundleRevisions(bundle!.id),
  });
  const previewQuery = useQuery({
    queryKey: ["effective", projectId],
    enabled: Boolean(projectId) && previewOpen,
    queryFn: () => api.getEffectiveConfig(projectId),
  });

  function invalidate() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["bundles", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["apply-jobs", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["revisions", bundle?.id] }),
      queryClient.invalidateQueries({ queryKey: ["effective", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["config-lock", projectId] }),
    ]);
  }

  const createBundle = useMutation({
    mutationFn: () => api.createProjectBundle(projectId, { name: "project" }),
    onSuccess: async () => {
      toast("已创建项目配置");
      await invalidate();
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "创建配置失败")),
  });

  const saveDraft = useMutation({
    mutationFn: (next: Manifest) => api.updateBundleDraft(bundle!.id, next, bundle!.etag),
    onSuccess: async () => {
      toast("草稿已保存");
      setEditor(null);
      await invalidate();
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "保存草稿失败")),
  });

  const saveSkill = useMutation({
    mutationFn: () =>
      api.importSkill(bundle!.id, {
        name: form.name ?? "",
        files: [{ path: "SKILL.md", content: form.content ?? "" }],
      }),
    onSuccess: async () => {
      toast("Skill 已写入草稿");
      setEditor(null);
      await invalidate();
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "保存 Skill 失败")),
  });

  const publish = useMutation({
    mutationFn: async () => {
      const revision = await api.publishBundle(bundle!.id);
      const applied = await api.applyConfig(projectId);
      return { revision, applied };
    },
    onSuccess: async ({ revision, applied }) => {
      const succeeded = applied.jobs.filter((job) => job.status === "succeeded").length;
      toast(
        applied.jobs.length === 0
          ? `已发布 v${revision.version}。在线工作区会自动同步，结果在「下发记录」里`
          : `已发布 v${revision.version}，${succeeded}/${applied.jobs.length} 个工作区下发成功`,
      );
      await invalidate();
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "发布失败")),
  });

  const rollback = useMutation({
    mutationFn: (revisionId: string) => api.rollbackBundle(bundle!.id, revisionId),
    onSuccess: async (revision) => {
      toast(`已回滚到 v${revision.version}，并重新下发`);
      setHistoryOpen(false);
      await invalidate();
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "回滚失败")),
  });

  const saveLock = useMutation({
    mutationFn: async () => {
      await api.updateBundleDraft(
        bundle!.id,
        { ...draft, model: form.model || undefined },
        bundle!.etag,
      );
      return api.putConfigLock(projectId, {
        lockMcp: form.lockMcp === "1",
        forcedAgents: lockQuery.data?.forcedAgents ?? [],
        denyMcp: lockQuery.data?.denyMcp ?? [],
        allowUserOverlay: lockQuery.data?.allowUserOverlay ?? true,
        userOverlayWhitelist: lockQuery.data?.userOverlayWhitelist ?? ["skills", "agents"],
      });
    },
    onSuccess: async () => {
      toast("权限与模型已保存");
      await invalidate();
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "保存失败")),
  });

  function openAgent(index: number | null) {
    const agent = index == null ? null : draft.agents[index];
    setForm({
      name: agent?.name ?? "",
      description: agent?.description ?? "",
      mode: agent?.mode ?? "primary",
      prompt: agent?.prompt ?? "",
    });
    setEditor({ kind: "agent", index });
  }

  function openMcp(index: number | null) {
    const mcp = index == null ? null : draft.mcp[index];
    setForm({
      name: mcp?.name ?? "",
      transport: mcp?.transport ?? "remote",
      command: mcp?.command?.join(" ") ?? "",
      url: mcp?.url ?? "",
      enabled: mcp?.enabled === false ? "0" : "1",
    });
    setEditor({ kind: "mcp", index });
  }

  function openSkill() {
    setForm({ name: "", content: "# Skill\n\n描述这个技能做什么。\n" });
    setEditor({ kind: "skill" });
  }

  function submitEditor() {
    if (!bundle) return;
    if (editor?.kind === "agent") {
      const name = (form.name ?? "").trim();
      if (!/^[a-z0-9-]{1,48}$/.test(name)) {
        toast("Agent 名称只能使用小写字母、数字和连字符");
        return;
      }
      const nextAgent = {
        name,
        description: (form.description ?? "").trim() || name,
        mode: (form.mode || "primary") as "primary" | "subagent" | "all",
        prompt: form.prompt ?? "",
      };
      const agents = [...draft.agents];
      if (editor.index == null) agents.push(nextAgent);
      else agents[editor.index] = nextAgent;
      saveDraft.mutate({ ...draft, agents });
    }
    if (editor?.kind === "mcp") {
      const name = (form.name ?? "").trim();
      if (!/^[a-z0-9_-]{1,48}$/.test(name)) {
        toast("MCP 名称只能使用小写字母、数字、下划线和连字符");
        return;
      }
      const transport = form.transport === "local" ? "local" : "remote";
      const nextMcp = {
        name,
        transport,
        enabled: form.enabled !== "0",
        ...(transport === "local"
          ? { command: (form.command ?? "").split(/\s+/).filter(Boolean) }
          : { url: (form.url ?? "").trim() }),
      } as Manifest["mcp"][number];
      const mcp = [...draft.mcp];
      if (editor.index == null) mcp.push(nextMcp);
      else mcp[editor.index] = nextMcp;
      saveDraft.mutate({ ...draft, mcp });
    }
    if (editor?.kind === "skill") {
      if (!/^[a-z0-9-]{1,48}$/.test(form.name ?? "")) {
        toast("Skill 名称只能使用小写字母、数字和连字符");
        return;
      }
      saveSkill.mutate();
    }
  }

  const assetTab = tab === "Agent" || tab === "MCP" || tab === "Skill" ? tab : null;

  return (
    <>
      <PageHeader
        eyebrow="工作空间"
        title="配置中心"
        description="门户是唯一配置来源。发布后写入每个工作区的受管文件，不会改动你自己创建的文件。"
        actions={
          <>
            <Button variant="secondary" disabled={!bundle} onClick={() => setPreviewOpen(true)}>
              合并预览
            </Button>
            <Button disabled={!canManage || !bundle || publish.isPending} onClick={() => publish.mutate()}>
              {publish.isPending ? "发布中…" : "发布与下发"}
            </Button>
          </>
        }
      />

      <div className={cn(ui.surface, ui.projectStrip)}>
        <span className={ui.projectIcon}>
          <Icon icon={Hammer} size="sm" />
        </span>
        <div>
          <strong>{project?.name ?? "未选择项目"}</strong>
          <small className="mt-0.5 block">租户基础配置 → 项目 Bundle → 个人 Overlay</small>
        </div>
        <span className={ui.projectStripMeta}>
          <Badge tone={bundle?.latestVersion ? "green" : "default"}>
            {bundle?.latestVersion ? `v${bundle.latestVersion}` : "未发布"}
          </Badge>
          <Badge tone={bundle ? "green" : "default"}>{bundle ? "草稿可编辑" : "尚无配置"}</Badge>
        </span>
        <span className={ui.divider} />
        <Button size="sm" variant="secondary" disabled={!bundle} onClick={() => setHistoryOpen(true)}>
          版本历史
        </Button>
      </div>

      {!bundle && !bundlesQuery.isLoading ? (
        <EmptyState surface>
          {bundlesQuery.isError ? (
            "暂时无法读取配置。请确认你有项目访问权限。"
          ) : (
            <>
              这个项目还没有配置包。
              {canManage ? (
                <div className="mt-3">
                  <Button disabled={createBundle.isPending} onClick={() => createBundle.mutate()}>
                    {createBundle.isPending ? "创建中…" : "创建项目配置"}
                  </Button>
                </div>
              ) : (
                <div>需要项目 owner 创建后再发布。</div>
              )}
            </>
          )}
        </EmptyState>
      ) : null}

      {bundle ? (
        <>
          <Tabs
            aria-label="配置分类"
            value={tab}
            onChange={setTab}
            items={TABS.map((item) => ({ value: item, label: item }))}
          />

          {assetTab ? (
            <>
              <div className={ui.toolbar}>
                <span className={ui.inlineNote}>
                  {assetTab === "Agent"
                    ? `${draft.agents.length} 个 Agent`
                    : assetTab === "MCP"
                      ? `${draft.mcp.length} 个 MCP · secret 只保存引用`
                      : `${draft.skills.length} 个 Skill`}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canManage}
                  onClick={() => {
                    if (assetTab === "Agent") openAgent(null);
                    else if (assetTab === "MCP") openMcp(null);
                    else openSkill();
                  }}
                >
                  <Icon icon={Plus} size="sm" />
                  新建 {assetTab}
                </Button>
              </div>
              {assetTab === "Agent" && draft.agents.length === 0 ? (
                <EmptyState surface>还没有 Agent。新建后保存到草稿，发布才会下发。</EmptyState>
              ) : null}
              {assetTab === "MCP" && draft.mcp.length === 0 ? (
                <EmptyState surface>还没有 MCP。本地命令必须在租户白名单内，默认允许 npx、node、uvx、docker、python。</EmptyState>
              ) : null}
              {assetTab === "Skill" && draft.skills.length === 0 ? (
                <EmptyState surface>还没有 Skill。每个技能都需要一份 SKILL.md。</EmptyState>
              ) : null}
              <div className={ui.grid3}>
                {assetTab === "Agent"
                  ? draft.agents.map((agent, index) => (
                      <article key={agent.name} className={cn(ui.surface, ui.assetCard)}>
                        <div className={ui.assetCardTop}>
                          <span className={ui.projectIcon}>
                            <Icon icon={index % 2 === 0 ? Command : Sparkles} size="sm" />
                          </span>
                          <Badge tone="green">{agent.mode ?? "primary"}</Badge>
                        </div>
                        <h3 className={ui.assetCardTitle}>{agent.name}</h3>
                        <p>{agent.description}</p>
                        <div className={ui.cardFooter}>
                          <span className={ui.badge}>项目配置</span>
                          <Button size="sm" variant="secondary" disabled={!canManage} onClick={() => openAgent(index)}>
                            编辑
                          </Button>
                        </div>
                      </article>
                    ))
                  : null}
                {assetTab === "MCP"
                  ? draft.mcp.map((mcp, index) => (
                      <article key={mcp.name} className={cn(ui.surface, ui.assetCard)}>
                        <div className={ui.assetCardTop}>
                          <span className={ui.projectIcon}>
                            <Icon icon={Zap} size="sm" />
                          </span>
                          <Badge tone={mcp.enabled ? "green" : "default"}>{mcp.enabled ? "已启用" : "已停用"}</Badge>
                        </div>
                        <h3 className={ui.assetCardTitle}>{mcp.name}</h3>
                        <p>
                          {mcp.transport === "local" ? mcp.command?.join(" ") : mcp.url}
                        </p>
                        <div className={ui.cardFooter}>
                          <span className={ui.badge}>{mcp.transport}</span>
                          <Button size="sm" variant="secondary" disabled={!canManage} onClick={() => openMcp(index)}>
                            编辑
                          </Button>
                        </div>
                      </article>
                    ))
                  : null}
                {assetTab === "Skill"
                  ? draft.skills.map((skill) => (
                      <article key={skill.name} className={cn(ui.surface, ui.assetCard)}>
                        <div className={ui.assetCardTop}>
                          <span className={ui.projectIcon}>
                            <Icon icon={FileStack} size="sm" />
                          </span>
                          <Badge tone="green">SKILL.md</Badge>
                        </div>
                        <h3 className={ui.assetCardTitle}>{skill.name}</h3>
                        <p>{skill.files.length} 个文件</p>
                        <div className={ui.cardFooter}>
                          <span className={ui.badge}>项目配置</span>
                        </div>
                      </article>
                    ))
                  : null}
              </div>
            </>
          ) : null}

          {tab === "AGENTS.md" ? (
            <div className={cn(ui.surface, ui.panel)}>
              <div className={ui.panelTitle}>
                <h2 className={ui.panelTitleH2}>AGENTS.md</h2>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canManage || saveDraft.isPending}
                  onClick={() =>
                    saveDraft.mutate({
                      ...draft,
                      instructions: { ...draft.instructions, agentsMd: form.agentsMd ?? draft.instructions.agentsMd ?? "" },
                    })
                  }
                >
                  保存草稿
                </Button>
              </div>
              <textarea
                className={ui.codeArea}
                spellCheck={false}
                value={form.agentsMd ?? draft.instructions.agentsMd ?? ""}
                onChange={(event) => setForm((prev) => ({ ...prev, agentsMd: event.target.value }))}
                readOnly={!canManage}
              />
              <p className={ui.inlineNote}>发布后写入工作区根目录的 AGENTS.md。个人 Overlay 不能覆盖这段项目说明。</p>
            </div>
          ) : null}

          {tab === "权限与模型" ? (
            <div className={cn(ui.surface, ui.settingsSection)}>
              <h2 className={ui.settingsSectionH2}>项目默认策略</h2>
              <p>更低层已经写成 deny 的权限，不会被后面的层改回 allow。</p>
              <div className={ui.formGrid}>
                <Field label="默认模型">
                  <Input
                    variant="field"
                    disabled={!canManage}
                    value={form.model ?? draft.model ?? ""}
                    placeholder="例如 anthropic/claude-sonnet"
                    onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
                  />
                </Field>
              </div>
              <div className={ui.settingRow}>
                <div>
                  <strong>锁定 MCP 列表</strong>
                  <small className="mt-0.5 block">锁定后，个人 Overlay 不能改 MCP</small>
                </div>
                <input
                  type="checkbox"
                  className="h-5 w-9 accent-ah-accent"
                  checked={(form.lockMcp ?? (lockQuery.data?.lockMcp ? "1" : "0")) === "1"}
                  disabled={!canManage}
                  aria-label="锁定 MCP 列表"
                  onChange={(event) => setForm((prev) => ({ ...prev, lockMcp: event.target.checked ? "1" : "0" }))}
                />
              </div>
              <Button disabled={!canManage || saveLock.isPending} onClick={() => saveLock.mutate()}>
                {saveLock.isPending ? "保存中…" : "保存"}
              </Button>
            </div>
          ) : null}

          {tab === "下发记录" ? (
            <div className={cn(ui.surface, ui.tableWrap)}>
              <table className={ui.dataTable}>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>触发</th>
                    <th>状态</th>
                    <th>校验</th>
                  </tr>
                </thead>
                <tbody>
                  {jobsQuery.isLoading ? (
                    <tr>
                      <td colSpan={4}>正在读取下发记录…</td>
                    </tr>
                  ) : null}
                  {!jobsQuery.isLoading && (jobsQuery.data?.items ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={4}>还没有下发记录。发布后，在线工作区的自动同步会出现在这里。</td>
                    </tr>
                  ) : null}
                  {(jobsQuery.data?.items ?? []).map((job) => {
                    const label = STATUS_LABEL[job.status];
                    return (
                      <tr key={job.id}>
                        <td>
                          <strong>{KIND_LABEL[job.kind]} {job.id.slice(0, 8)}</strong>
                          <small>{job.targetHash.slice(0, 12)}</small>
                        </td>
                        <td>{TRIGGER_LABEL[job.trigger]}</td>
                        <td>
                          <Badge tone={label.tone}>{label.text}</Badge>
                        </td>
                        <td>{job.error ?? (job.status === "succeeded" ? "已按清单写好" : "等待结果")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}

      <Banner icon={Info} className="mt-[22px]">
        发布后，在线工作区会自动同步。成功和失败都记在「下发记录」里。外部实例由 agenthub-sync 拉取，未连接时任务会标成部分成功。回滚只恢复受管文件，不会改动你自己创建的文件。
      </Banner>

      <Modal
        open={editor != null}
        title={editor?.kind === "agent" ? "Agent" : editor?.kind === "mcp" ? "MCP" : "Skill"}
        onClose={() => setEditor(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditor(null)}>
              取消
            </Button>
            <Button disabled={saveDraft.isPending || saveSkill.isPending} onClick={submitEditor}>
              保存
            </Button>
          </>
        }
      >
        {editor?.kind === "agent" ? (
          <div className={ui.formGrid}>
            <Field label="名称" full>
              <Input variant="field" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="说明" full>
              <Input variant="field" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="模式">
              <Select variant="field" value={form.mode ?? "primary"} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                <option value="primary">primary</option>
                <option value="subagent">subagent</option>
                <option value="all">all</option>
              </Select>
            </Field>
            <Field label="提示词" full>
              <textarea className={ui.codeArea} value={form.prompt ?? ""} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
            </Field>
          </div>
        ) : null}
        {editor?.kind === "mcp" ? (
          <div className={ui.formGrid}>
            <Field label="名称" full>
              <Input variant="field" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="传输">
              <Select variant="field" value={form.transport ?? "remote"} onChange={(e) => setForm({ ...form, transport: e.target.value })}>
                <option value="remote">remote</option>
                <option value="local">local</option>
              </Select>
            </Field>
            {form.transport === "local" ? (
              <Field label="命令" full hint="例如 npx -y some-mcp">
                <Input variant="field" value={form.command ?? ""} onChange={(e) => setForm({ ...form, command: e.target.value })} />
              </Field>
            ) : (
              <Field label="URL" full>
                <Input variant="field" value={form.url ?? ""} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              </Field>
            )}
          </div>
        ) : null}
        {editor?.kind === "skill" ? (
          <div className={ui.formGrid}>
            <Field label="名称" full>
              <Input variant="field" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="SKILL.md" full>
              <textarea className={ui.codeArea} value={form.content ?? ""} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal open={previewOpen} title="合并预览" onClose={() => setPreviewOpen(false)}>
        {previewQuery.isLoading ? <p>正在合并…</p> : null}
        {previewQuery.data ? (
          <div className="space-y-2 text-[11px] leading-relaxed text-[#475467]">
            <div>这是已经发布的合并结果。草稿要发布后才会出现在这里。</div>
            <div>摘要 {previewQuery.data.hash.slice(0, 16)}</div>
            <div>Agent：{previewQuery.data.manifest.agents.map((item) => item.name).join("、") || "无"}</div>
            <div>MCP：{previewQuery.data.manifest.mcp.map((item) => item.name).join("、") || "无"}</div>
            <div>Skill：{previewQuery.data.manifest.skills.map((item) => item.name).join("、") || "无"}</div>
            <pre className={ui.codeArea}>{previewQuery.data.manifest.instructions.agentsMd || "（空）"}</pre>
          </div>
        ) : null}
      </Modal>

      <Modal open={historyOpen} title="版本历史" onClose={() => setHistoryOpen(false)}>
        <div className="space-y-2">
          {(revisionsQuery.data?.items ?? []).map((revision) => (
            <div key={revision.id} className="flex items-center justify-between gap-3 text-[11px]">
              <div>
                <strong>v{revision.version}</strong>
                <span className="ml-2 text-[#667085]">{revision.state === "published" ? "当前" : "已归档"}</span>
              </div>
              {revision.state === "archived" && canManage ? (
                <Button size="sm" variant="secondary" disabled={rollback.isPending} onClick={() => rollback.mutate(revision.id)}>
                  <Icon icon={Check} size="xs" />
                  回滚
                </Button>
              ) : null}
            </div>
          ))}
          {revisionsQuery.isLoading ? <p className={ui.inlineNote}>正在读取版本…</p> : null}
          {!revisionsQuery.isLoading && (revisionsQuery.data?.items ?? []).length === 0 ? (
            <p className={ui.inlineNote}>还没有发布过版本。</p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
