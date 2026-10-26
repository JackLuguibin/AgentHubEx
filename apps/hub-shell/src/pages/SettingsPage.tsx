import { Button, Field, Input, PageHeader, Select, cn, ui } from "@agenthub/hub-ui-kit";
import { useParams } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";

export function SettingsPage() {
  const { projectId = "" } = useParams();
  const { user } = useAuth();
  const { projects, tenantId } = useTenant();
  const project = projects.find((p) => p.id === projectId);
  const tenantName =
    user?.tenants.find((t) => t.id === tenantId)?.name ?? "当前租户";

  return (
    <>
      <PageHeader
        eyebrow="项目配置"
        title="项目设置"
        description="项目级运行策略、共享空间和安全边界。"
        actions={
          <Button disabled title="P1">
            保存设置
          </Button>
        }
      />

      <div className={cn(ui.surface, ui.settingsSection)}>
        <h2 className={ui.settingsSectionH2}>基本信息</h2>
        <p>项目属于 {tenantName}，项目标识用于关联问题与会话。</p>
        <div className={ui.formGrid}>
          <Field label="项目名称">
            <Input
              variant="field"
              defaultValue={project?.name ?? "agenthubex"}
              readOnly
            />
          </Field>
          <Field label="项目标识" hint="创建后不可修改">
            <Input variant="field" value={project?.key ?? "AH"} disabled />
          </Field>
          <Field label="项目说明" full>
            <textarea
              className={cn(ui.fieldControl, ui.fieldTextarea)}
              defaultValue="面向多成员的强隔离 Agent 平台。"
              readOnly
            />
          </Field>
        </div>
      </div>

      <div className={cn(ui.surface, ui.settingsSection)}>
        <h2 className={ui.settingsSectionH2}>运行与凭据策略</h2>
        <p>成员在自己的独立工作区创建会话。</p>
        <div className={ui.formGrid}>
          <Field label="允许的凭据来源">
            <Select variant="field" disabled defaultValue="user_or_project">
              <option value="user_or_project">个人与项目均可</option>
              <option value="project_only">仅项目共享凭据</option>
              <option value="user_only">仅个人凭据</option>
            </Select>
          </Field>
          <Field label="闲置回收 TTL · Phase 2">
            <Select variant="field" disabled>
              <option>30 分钟</option>
            </Select>
          </Field>
        </div>
        <div className={ui.settingRow}>
          <div>
            <strong>独立工作区隔离</strong>
            <small>每个成员拥有独立 Workspace；会话仅对 owner 可见</small>
          </div>
          <input
            type="checkbox"
            className="h-5 w-9 accent-ah-accent"
            checked
            disabled
            readOnly
            aria-label="工作区隔离"
          />
        </div>
      </div>

      <div className={cn(ui.surface, ui.settingsSection)}>
        <h2 className={ui.settingsSectionH2}>公共空间</h2>
        <p>挂载到个人工作区的只读路径与受保护前缀。</p>
        <div className={ui.formGrid}>
          <Field label="挂载路径">
            <Input variant="field" value="/workspace/project-common" disabled />
          </Field>
          <Field label="受保护前缀">
            <Input variant="field" defaultValue="docs/" readOnly />
          </Field>
        </div>
      </div>
    </>
  );
}
