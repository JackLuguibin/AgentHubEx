import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@agenthub/domain";
import { Button, Field, Input, PageHeader, Select, cn, ui } from "@agenthub/hub-ui-kit";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";
import { api } from "../lib/api.js";
import { getApiErrorMessage } from "../lib/api-error.js";
import { useToast } from "../lib/toast.js";

type FormState = {
  name: string;
  description: string;
  credentialPolicy: Project["credentialPolicy"];
  commonSyncPolicy: Project["commonSyncPolicy"];
  defaultRuntimeType: "opencode" | "claude";
  allowedProviderHosts: string;
};

function hostsOf(project: Project | undefined) {
  return (project?.settings.allowedProviderHosts ?? []).join("\n");
}

export function SettingsPage() {
  const { projectId = "" } = useParams();
  const { user } = useAuth();
  const { tenantId, projects } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const listed = projects.find((item) => item.id === projectId);
  const tenantRole = user?.tenants.find((item) => item.id === tenantId)?.role;
  const canEdit =
    tenantRole === "owner" || tenantRole === "admin" || listed?.myRole === "owner";

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    enabled: Boolean(projectId),
    queryFn: () => api.getProject(projectId),
  });
  const commonQuery = useQuery({
    queryKey: ["common-settings", projectId],
    enabled: Boolean(projectId),
    queryFn: () => api.getCommonSettings(projectId),
  });

  const project = projectQuery.data;
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (!project) return;
    setForm({
      name: project.name,
      description: project.description ?? "",
      credentialPolicy: project.credentialPolicy,
      commonSyncPolicy: project.commonSyncPolicy,
      defaultRuntimeType: project.settings.defaultRuntimeType ?? "opencode",
      allowedProviderHosts: hostsOf(project),
    });
  }, [project]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error("设置尚未加载");
      const hosts = form.allowedProviderHosts
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      return api.patchProject(projectId, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        credentialPolicy: form.credentialPolicy,
        commonSyncPolicy: form.commonSyncPolicy,
        settings: {
          defaultRuntimeType: form.defaultRuntimeType,
          allowedProviderHosts: hosts,
        },
      });
    },
    onSuccess: async (updated) => {
      toast("项目设置已保存");
      setForm({
        name: updated.name,
        description: updated.description ?? "",
        credentialPolicy: updated.credentialPolicy,
        commonSyncPolicy: updated.commonSyncPolicy,
        defaultRuntimeType: updated.settings.defaultRuntimeType ?? "opencode",
        allowedProviderHosts: hostsOf(updated),
      });
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects", tenantId] });
    },
    onError: async (err) => toast(await getApiErrorMessage(err, "保存设置失败")),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!form?.name.trim()) {
      toast("请填写项目名称");
      return;
    }
    save.mutate();
  };

  const prefixes = commonQuery.data?.protectedPrefixes ?? [];

  return (
    <form onSubmit={onSubmit}>
      <PageHeader
        eyebrow="项目配置"
        title="项目设置"
        description="项目级运行策略。保护前缀在公共文件页修改，这里只展示同一份设置。"
        actions={
          <Button type="submit" disabled={!canEdit || !form || save.isPending}>
            保存设置
          </Button>
        }
      />

      <div className={cn(ui.surface, ui.settingsSection)}>
        <h2 className={ui.settingsSectionH2}>基本信息</h2>
        <p>项目标识创建后不能修改。</p>
        <div className={ui.formGrid}>
          <Field label="项目名称">
            <Input
              variant="field"
              value={form?.name ?? ""}
              disabled={!canEdit || !form}
              onChange={(e) => setForm((current) => current && { ...current, name: e.target.value })}
            />
          </Field>
          <Field label="项目标识" hint="创建后不可修改">
            <Input variant="field" value={project?.key ?? listed?.key ?? ""} disabled />
          </Field>
          <Field label="项目说明" full>
            <textarea
              className={cn(ui.fieldControl, ui.fieldTextarea)}
              value={form?.description ?? ""}
              disabled={!canEdit || !form}
              onChange={(e) =>
                setForm((current) => current && { ...current, description: e.target.value })
              }
            />
          </Field>
        </div>
      </div>

      <div className={cn(ui.surface, ui.settingsSection)}>
        <h2 className={ui.settingsSectionH2}>运行与凭据策略</h2>
        <p>改成「仅个人凭据」后，新会话不能再选项目共享凭据。</p>
        <div className={ui.formGrid}>
          <Field label="允许的凭据来源">
            <Select
              variant="field"
              value={form?.credentialPolicy ?? "user_or_project"}
              disabled={!canEdit || !form}
              onChange={(e) =>
                setForm(
                  (current) =>
                    current && {
                      ...current,
                      credentialPolicy: e.target.value as Project["credentialPolicy"],
                    },
                )
              }
            >
              <option value="user_or_project">个人与项目均可</option>
              <option value="project_only">仅项目共享凭据</option>
              <option value="user_only">仅个人凭据</option>
            </Select>
          </Field>
          <Field label="公共文件同步">
            <Select
              variant="field"
              value={form?.commonSyncPolicy ?? "on_workspace_start"}
              disabled={!canEdit || !form}
              onChange={(e) =>
                setForm(
                  (current) =>
                    current && {
                      ...current,
                      commonSyncPolicy: e.target.value as Project["commonSyncPolicy"],
                    },
                )
              }
            >
              <option value="on_workspace_start">进入工作区时同步</option>
              <option value="on_common_publish">公共文件发布后同步</option>
            </Select>
          </Field>
          <Field label="默认引擎">
            <Select
              variant="field"
              value={form?.defaultRuntimeType ?? "opencode"}
              disabled={!canEdit || !form}
              onChange={(e) =>
                setForm(
                  (current) =>
                    current && {
                      ...current,
                      defaultRuntimeType: e.target.value === "claude" ? "claude" : "opencode",
                    },
                )
              }
            >
              <option value="opencode">OpenCode</option>
              <option value="claude">Claude</option>
            </Select>
          </Field>
          <Field label="闲置回收" hint="要等托管节点调度，这一项现在不能改">
            <Select variant="field" disabled>
              <option>尚未开放</option>
            </Select>
          </Field>
          <Field label="允许的模型主机名" hint="一行一个。留空表示不限制 Base URL 主机。" full>
            <textarea
              className={cn(ui.fieldControl, ui.fieldTextarea)}
              value={form?.allowedProviderHosts ?? ""}
              disabled={!canEdit || !form}
              onChange={(e) =>
                setForm((current) => current && { ...current, allowedProviderHosts: e.target.value })
              }
            />
          </Field>
        </div>
      </div>

      <div className={cn(ui.surface, ui.settingsSection)}>
        <h2 className={ui.settingsSectionH2}>公共空间</h2>
        <p>
          保护前缀与公共文件页是同一份数据。
          <Link className={ui.textLink} to={`/p/${projectId}/files`}>
            去公共文件页修改
          </Link>
        </p>
        <div className={ui.formGrid}>
          <Field label="挂载路径">
            <Input variant="field" value="/workspace/project-common" disabled />
          </Field>
          <Field label="受保护前缀">
            <Input
              variant="field"
              value={prefixes.length > 0 ? prefixes.join("、") : "还没有受保护前缀"}
              readOnly
            />
          </Field>
        </div>
      </div>
    </form>
  );
}
