import { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";
import {
  filterSwitcherProjects,
  filterSwitcherTenants,
} from "../lib/space-availability.js";
import { useToast } from "../lib/toast.js";
import { getApiErrorMessage } from "../lib/api-error.js";

export function TopbarSwitcher({ crumb }: { crumb: string }) {
  const { user } = useAuth();
  const {
    tenantId,
    projects,
    projectId,
    setProjectId,
    switchTenant,
    loadingProjects,
  } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const switchableTenants = useMemo(
    () => filterSwitcherTenants(user?.tenants ?? []),
    [user?.tenants],
  );

  const switchableProjects = useMemo(
    () => filterSwitcherProjects(projects),
    [projects],
  );

  const onTenantChange = async (nextId: string) => {
    if (!nextId || nextId === tenantId) return;
    try {
      await switchTenant(nextId);
      toast("已切换租户，项目上下文已刷新");
      navigate(`/t/${nextId}/projects`);
    } catch (err) {
      toast(await getApiErrorMessage(err, "切换租户失败"));
    }
  };

  const onProjectChange = (id: string) => {
    if (!id) return;
    setProjectId(id);
    const page =
      location.pathname.match(/\/p\/[^/]+\/([^/?]+)/)?.[1] ?? "overview";
    navigate(`/p/${id}/${page}`);
  };

  const noBound = switchableTenants.length === 0;

  return (
    <div className="flex min-w-0 items-center gap-3 text-[11px] text-[#667085]">
      <span className="max-[680px]:hidden">工作空间</span>
      <span className="max-[680px]:hidden">/</span>
      {noBound ? (
        <Link
          to="/tenants"
          className="truncate font-semibold text-ah-accent no-underline"
        >
          暂无可用租户 · 前往管理
        </Link>
      ) : (
        <>
          <select
            aria-label="切换租户"
            className="max-w-36 cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#344054]"
            value={
              switchableTenants.some((t) => t.id === tenantId)
                ? (tenantId ?? "")
                : ""
            }
            onChange={(e) => void onTenantChange(e.target.value)}
          >
            {!switchableTenants.some((t) => t.id === tenantId) ? (
              <option value="">选择租户</option>
            ) : null}
            {switchableTenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span>/</span>
          {loadingProjects ? (
            <span className="text-ah-muted">加载项目…</span>
          ) : switchableProjects.length === 0 ? (
            <Link
              to={tenantId ? `/t/${tenantId}/projects` : "/projects"}
              className="truncate font-semibold text-ah-accent no-underline"
            >
              暂无可用项目 · 前往管理
            </Link>
          ) : (
            <select
              aria-label="切换项目"
              className="max-w-40 cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#344054]"
              value={
                switchableProjects.some((p) => p.id === projectId)
                  ? (projectId ?? "")
                  : ""
              }
              onChange={(e) => onProjectChange(e.target.value)}
            >
              {!switchableProjects.some((p) => p.id === projectId) ? (
                <option value="">选择项目</option>
              ) : null}
              {switchableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      <span>/</span>
      <strong className="truncate font-medium text-[#344054]">{crumb}</strong>
    </div>
  );
}
