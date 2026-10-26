import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Badge,
  Button,
  EmptyState,
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
import { Plus, FolderKanban } from "lucide-react";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";

export function ProjectsPage() {
  const { user } = useAuth();
  const { projects, projectId, setProjectId, loadingProjects, tenantId } = useTenant();
  const [query, setQuery] = useState("");
  const tenant =
    user?.tenants.find((t) => t.id === tenantId)?.name ?? "当前租户";
  const role =
    user?.tenants.find((t) => t.id === tenantId)?.role ?? "—";

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q),
    );
  }, [projects, query]);

  return (
    <>
      <PageHeader
        eyebrow="平台与组织"
        title="项目管理"
        description="按租户组织项目，配置成员、运行实例池和默认策略。"
        actions={
          <>
            <Button variant="secondary" disabled title="P1">
              用户与归属
            </Button>
            <Button disabled title="P1">
              <Icon icon={Plus} size="sm" />
              新建项目
            </Button>
          </>
        }
      />

      <StatGrid>
        <Stat label="当前租户项目" value={projects.length} note={tenant} />
        <Stat label="进行中" value={projects.length} note="可创建个人工作区" />
        <Stat label="已归档" value={0} note="保留资料与历史记录" />
        <Stat
          label="租户角色"
          value={<span className="text-lg tracking-normal">{role}</span>}
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
        <Button size="sm" variant="secondary" disabled title="P1">
          租户详情
        </Button>
      </div>

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
        <Select aria-label="项目状态" defaultValue="all" disabled>
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
          请通过 seed 或 API 创建项目后再进入工作台。
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
              {list.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong className="inline-flex items-center gap-1">
                      <Icon icon={FolderKanban} size="xs" />
                      {p.name}
                    </strong>
                    {p.id === projectId ? <Badge tone="green">当前项目</Badge> : null}
                    <small>
                      {p.key} · 面向多成员的强隔离 Agent 平台
                    </small>
                  </td>
                  <td>
                    Platform Admin
                    <small>示意成员数</small>
                  </td>
                  <td>
                    OpenCode · external
                    <small>Bundle v1.12</small>
                  </td>
                  <td>
                    <span className={ui.badge}>个人或项目</span>
                  </td>
                  <td>
                    <Badge tone="green">进行中</Badge>
                  </td>
                  <td className={ui.tableActions}>
                    <Link
                      className={ui.textLink}
                      style={{ color: "var(--accent)" }}
                      to={`/p/${p.id}/overview`}
                      onClick={() => setProjectId(p.id)}
                    >
                      进入
                    </Link>
                    <Button size="sm" variant="secondary" disabled title="P1">
                      管理
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
