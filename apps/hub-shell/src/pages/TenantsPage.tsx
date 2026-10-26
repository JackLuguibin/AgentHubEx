import { useMemo, useState } from "react";
import {
  Badge,
  Banner,
  Button,
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

export function TenantsPage() {
  const { user } = useAuth();
  const { tenantId, switchTenant, projects } = useTenant();
  const [query, setQuery] = useState("");
  const tenants = user?.tenants ?? [];

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
    );
  }, [query, tenants]);

  return (
    <>
      <PageHeader
        eyebrow="PLATFORM / TENANTS"
        title="租户管理"
        description="管理组织、所有者、资源配额与租户生命周期。"
        actions={
          <>
            <Button variant="secondary" disabled title="P1">
              用户与归属
            </Button>
            <Button disabled title="P1">
              <Icon icon={Plus} size="sm" />
              新建租户
            </Button>
          </>
        }
      />

      <StatGrid>
        <Stat label="全部租户" value={tenants.length} note="按 tenant_id 隔离" />
        <Stat label="运行中" value={tenants.length} note="可访问项目与工作区" />
        <Stat label="项目总数" value={projects.length} note="项目归属于唯一租户" />
        <Stat
          label="并发总额度"
          value={Math.max(tenants.length * 8, 8)}
          note="运行中租户配额合计 · 示意"
        />
      </StatGrid>

      <div className={cn(ui.surface, ui.managementGuidance)}>
        <div>
          <strong>平台管理边界</strong>
          <p>平台管理员管理租户元数据与配额；成员的会话正文与个人凭据保持私有。</p>
        </div>
        <Badge tone="purple">平台管理员 · 演示</Badge>
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
        <Select aria-label="租户状态" defaultValue="all" disabled>
          <option value="all">全部状态</option>
          <option value="active">运行中</option>
          <option value="suspended">已停用</option>
        </Select>
      </FilterToolbar>

      <Banner icon={Info}>
        切换租户会刷新 JWT 中的 tenant 声明；项目列表与工作区上下文随之切换。
      </Banner>

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
            {list.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong className="inline-flex items-center gap-1">
                    <Icon icon={FolderKanban} size="xs" />
                    {t.name}
                  </strong>
                  {t.id === tenantId ? <Badge tone="green">当前租户</Badge> : null}
                  <small>
                    {t.slug} · {t.id.slice(0, 8)}…
                  </small>
                </td>
                <td>
                  {user?.displayName ?? "—"}
                  <small>{user?.email ?? ""}</small>
                </td>
                <td>{t.id === tenantId ? projects.length : "—"}</td>
                <td>
                  <strong>8 并发</strong>
                  <small>10M Token / 日 · 50 GB 磁盘</small>
                </td>
                <td>
                  <Badge tone="green">运行中</Badge>
                </td>
                <td className={ui.tableActions}>
                  {t.id === tenantId ? (
                    <span className={ui.badge}>使用中</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void switchTenant(t.id)}
                    >
                      切换
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" disabled title="P1">
                    详情
                  </Button>
                </td>
              </tr>
            ))}
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
    </>
  );
}
