import { useEffect, useMemo, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { Avatar, cn, Icon } from "@agenthub/hub-ui-kit";
import {
  ArrowUpRight,
  Bell,
  ChevronDown,
  Menu,
  MoreHorizontal,
  PanelLeft,
  Search,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";
import { TopbarSwitcher } from "../components/TopbarSwitcher.js";
import {
  filterSwitcherTenants,
  isProjectUsable,
  isTenantUsable,
} from "../lib/space-availability.js";
import { useToast } from "../lib/toast.js";
import {
  adminNav,
  crumbLabels,
  managementNav,
  workspaceNav,
  type NavItem,
} from "../nav.js";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  return name.slice(0, 2).toUpperCase() || "AH";
}

function NavGroup({
  label,
  hint,
  items,
  projectId,
  tenantId,
  collapsed,
}: {
  label: string;
  hint?: string;
  items: NavItem[];
  projectId: string | null;
  tenantId: string | null;
  collapsed: boolean;
}) {
  return (
    <>
      {collapsed ? <div className="mx-2 mb-2 hidden h-px bg-ah-line min-[681px]:block" /> : null}
      <div
        className={cn(
          "mx-3 mb-[11px] flex justify-between text-[10px] tracking-[1px] text-[#96a098]",
          collapsed && "min-[681px]:hidden",
        )}
      >
        {label}
        {hint ? <span className="text-[8px] tracking-[0.5px]">{hint}</span> : null}
      </div>
      <nav className="mb-[22px] grid gap-1">
        {items.map((item) => {
          const to =
            item.scope === "platform"
              ? item.key === "projects"
                ? tenantId
                  ? `/t/${tenantId}/projects`
                  : "/projects"
                : `/${item.key}`
              : projectId
                ? `/p/${projectId}/${item.key}`
                : tenantId
                  ? `/t/${tenantId}/projects`
                  : "/projects";
          const ItemIcon = item.icon;
          return (
            <NavLink
              key={item.key}
              to={to}
              end={item.scope === "platform"}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-[7px] py-[11px] text-xs text-[#475467] no-underline hover:bg-[#f2f4f7]",
                  collapsed ? "px-[13px] min-[681px]:justify-center min-[681px]:px-2" : "px-[13px]",
                  isActive && "bg-ah-accent-soft font-[650] text-ah-accent",
                )
              }
            >
              <ItemIcon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.6} />
              <span className={cn(collapsed && "min-[681px]:sr-only")}>{item.label}</span>
              {item.phase ? (
                <span className={cn("ml-auto text-[9px] text-[#a0aaa1]", collapsed && "min-[681px]:hidden")}>
                  {item.phase}
                </span>
              ) : null}
            </NavLink>
          );
        })}
      </nav>
    </>
  );
}

export function ShellLayout() {
  const { user, logout } = useAuth();
  const { tenantId, projects, projectId, switchTenant, loadingProjects } =
    useTenant();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const { toast } = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("ah.sidebar") === "collapsed",
  );
  const workbench = location.pathname.includes("/workbench");
  const toggleSidebar = () => {
    setSidebarCollapsed((value) => {
      const next = !value;
      localStorage.setItem("ah.sidebar", next ? "collapsed" : "open");
      return next;
    });
  };

  const activeProjectId = params.projectId ?? projectId;
  const tenant = user?.tenants.find((t) => t.id === tenantId) ?? user?.tenants[0];
  const activeProject =
    projects.find((p) => p.id === activeProjectId) ??
    projects.find((p) => p.id === projectId) ??
    null;

  const crumb = useMemo(() => {
    const seg = location.pathname.split("/").filter(Boolean);
    const last = seg[seg.length - 1] ?? "";
    if (last in crumbLabels) return crumbLabels[last]!;
    if (seg[0] === "projects" || (seg[0] === "t" && seg[2] === "projects")) {
      return "项目管理";
    }
    if (seg[0] === "tenants") return "租户管理";
    return "项目概览";
  }, [location.pathname]);

  // Block workspace entry when tenant suspended or project archived / unbound.
  useEffect(() => {
    const onProjectRoute = location.pathname.startsWith("/p/");
    if (!onProjectRoute || loadingProjects) return;
    const tenantOk = isTenantUsable(
      tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            status: tenant.status,
          }
        : null,
    );
    // Unknown project id after load ⇒ treat as unavailable.
    const projectOk = activeProject
      ? isProjectUsable(activeProject)
      : Boolean(activeProjectId) === false;
    if (!tenantOk || (activeProjectId && !projectOk)) {
      toast("租户或项目不可用，工作区入口已阻断");
      navigate(tenantId ? `/t/${tenantId}/projects` : "/projects", {
        replace: true,
      });
    }
  }, [
    location.pathname,
    tenant,
    activeProject,
    activeProjectId,
    tenantId,
    loadingProjects,
    navigate,
    toast,
  ]);

  const switchableTenants = filterSwitcherTenants(user?.tenants ?? []);

  return (
    <>
      <aside
        id="sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-20 flex h-dvh w-sidebar flex-col overflow-hidden border-r border-ah-line bg-white px-[18px] pb-4 pt-7",
          "max-[680px]:-translate-x-full max-[680px]:shadow-[8px_0_30px_#143a1e20] max-[680px]:transition-transform",
          sidebarOpen && "max-[680px]:translate-x-0",
          sidebarCollapsed
            ? "min-[681px]:w-[72px] min-[681px]:px-2"
            : "max-[960px]:w-[210px] max-[960px]:px-[13px] max-[960px]:pt-[22px]",
        )}
      >
        <Link
          className="flex items-center gap-[9px] px-2 text-[21px] font-[750] tracking-[-0.8px] text-ah-text no-underline"
          to={
            activeProjectId && isProjectUsable(activeProject)
              ? `/p/${activeProjectId}/overview`
              : tenantId
                ? `/t/${tenantId}/projects`
                : "/projects"
          }
        >
          <span className="relative inline-flex h-[31px] w-[29px] items-center justify-center rounded-lg bg-ah-accent text-[17px] text-white">
            a
            <Icon
              icon={ArrowUpRight}
              size="xs"
              className="absolute -top-[3px] right-px text-white"
            />
          </span>
          <span className={cn(sidebarCollapsed && "min-[681px]:hidden")}>AgentHub</span>
          <span
            className={cn(
              "-ml-[5px] rounded bg-[#f8fafc] px-1 py-[3px] text-[9px] tracking-[0.5px] text-[#475467]",
              sidebarCollapsed && "min-[681px]:hidden",
            )}
          >
            EX
          </span>
        </Link>

        <button
          type="button"
          className={cn(
            "my-7 mb-6 flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] border border-ah-line bg-white px-2 py-3 text-left hover:bg-[#fafbfe]",
            sidebarCollapsed && "min-[681px]:justify-center min-[681px]:px-0",
          )}
          onClick={() => {
            if (switchableTenants.length < 2 || !tenantId) {
              navigate("/tenants");
              return;
            }
            const idx = switchableTenants.findIndex((t) => t.id === tenantId);
            const next =
              switchableTenants[(idx + 1) % switchableTenants.length]!;
            void switchTenant(next.id).then(() => {
              navigate(`/t/${next.id}/projects`);
            });
          }}
          title="切换租户"
        >
          <span className="grid h-[30px] w-[30px] place-items-center rounded-[7px] border border-ah-line bg-[#f8fafc] text-[11px] font-bold text-[#475467]">
            {(tenant?.name ?? "T").slice(0, 1).toUpperCase()}
          </span>
          <span className={cn("min-w-0 flex-1", sidebarCollapsed && "min-[681px]:hidden")}>
            <strong className="block truncate text-xs text-[#344054]">
              {tenant?.name ?? "未选择租户"}
            </strong>
            <small className="mt-1 block text-[10px] text-ah-muted">
              团队空间 · {tenant?.role ?? "—"}
              {tenant?.status === "suspended" ? " · 已停用" : ""}
            </small>
          </span>
          <Icon icon={ChevronDown} size="sm" className={cn("text-ah-muted", sidebarCollapsed && "min-[681px]:hidden")} />
        </button>

        <div
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 -mx-2 [scrollbar-width:thin]"
          aria-label="平台导航"
        >
          <NavGroup
            label="平台与组织"
            items={managementNav}
            projectId={activeProjectId}
            tenantId={tenantId}
            collapsed={sidebarCollapsed}
          />
          <NavGroup
            label="工作空间"
            items={workspaceNav}
            projectId={activeProjectId}
            tenantId={tenantId}
            collapsed={sidebarCollapsed}
          />
          <NavGroup
            label="项目配置"
            hint="OWNER"
            items={adminNav}
            projectId={activeProjectId}
            tenantId={tenantId}
            collapsed={sidebarCollapsed}
          />
        </div>

        <div className="mt-3 shrink-0 border-t border-ah-line bg-white pt-3">
          <div
            className={cn(
              "rounded-lg border border-ah-line bg-[#f8fafc] p-[13px] text-[10px] text-[#475467]",
              sidebarCollapsed && "min-[681px]:hidden",
            )}
          >
            <div>
              今日 Token 用量 <strong className="float-right text-ah-accent">12%</strong>
            </div>
            <div className="my-[11px] h-1 overflow-hidden rounded-[5px] bg-[#e9edf5]">
              <i className="block h-full rounded-[inherit] bg-[#6b83e9]" style={{ width: "12%" }} />
            </div>
            <small className="mt-0.5 block text-[9px] text-ah-muted">
              示意用量 · 正式计量后续接入
            </small>
          </div>
          <button
            type="button"
            className="mt-3 flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-[5px] pt-2 text-left"
            onClick={() =>
              void logout().then(() => {
                navigate("/login");
              })
            }
            title="退出登录"
          >
            <Avatar tone="green">{initials(user?.displayName ?? "AH")}</Avatar>
            <span className={cn("min-w-0 flex-1", sidebarCollapsed && "min-[681px]:hidden")}>
              <strong className="block truncate text-xs text-[#344054]">
                {user?.displayName}
              </strong>
              <small className="mt-1 block text-[10px] text-ah-muted">
                {user?.isPlatformAdmin ? "平台管理员" : (tenant?.role ?? "成员")}
              </small>
            </span>
            <Icon
              icon={MoreHorizontal}
              size="sm"
              className={cn("text-ah-muted", sidebarCollapsed && "min-[681px]:hidden")}
            />
          </button>
        </div>
      </aside>

      <div
        className={cn(
          "grid h-dvh min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]",
          sidebarCollapsed ? "ml-[72px] max-[680px]:ml-0" : "ml-sidebar max-[960px]:ml-[210px] max-[680px]:ml-0",
        )}
      >
        <header className="z-10 flex h-[62px] min-w-0 items-center justify-between border-b border-ah-line bg-white px-6 max-[680px]:h-[60px] max-[680px]:gap-2.5 max-[680px]:px-[15px]">
          <button
            type="button"
            className="hidden place-items-center border-0 bg-transparent text-[20px] text-[#829087] max-[680px]:grid max-[680px]:h-[30px] max-[680px]:w-[30px]"
            aria-label="打开导航"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Icon icon={Menu} size="md" />
          </button>
          <button
            type="button"
            className="mr-3 hidden h-8 w-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[#667085] hover:bg-[#f2f4f7] hover:text-[#344054] min-[681px]:grid"
            aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-pressed={sidebarCollapsed}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            onClick={toggleSidebar}
          >
            <Icon icon={PanelLeft} size="md" />
          </button>
          <TopbarSwitcher crumb={crumb} />
          <div className="flex shrink-0 items-center gap-4">
            <span className="rounded-[5px] border border-[#e5e9e4] px-2 py-[5px] text-[9px] tracking-[0.5px] text-[#8b958b] max-[680px]:hidden">
              P1 · 租户/项目
            </span>
            <button
              type="button"
              className="grid h-[30px] w-[26px] cursor-pointer place-items-center border-0 bg-transparent text-[#829087] hover:text-[#344054] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="搜索问题"
              title={activeProjectId ? "搜索问题" : "请先进入项目"}
              disabled={!activeProjectId}
              onClick={() => {
                if (activeProjectId) navigate(`/p/${activeProjectId}/board?search=1`);
              }}
            >
              <Icon icon={Search} size="md" />
            </button>
            <button
              type="button"
              className="grid h-[30px] w-[26px] cursor-not-allowed place-items-center border-0 bg-transparent text-[#829087]"
              aria-label="通知"
              title="这一阶段没有通知中心"
              disabled
            >
              <Icon icon={Bell} size="md" />
            </button>
            <Avatar tone="green">{initials(user?.displayName ?? "AH")}</Avatar>
          </div>
        </header>

        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-col gap-3 overflow-auto px-6 py-5 pb-4 max-[680px]:px-4 [&>*]:min-w-0 [&>*:not(.flex-1)]:shrink-0",
            workbench && "gap-0 overflow-hidden p-0",
          )}
          onClick={() => setSidebarOpen(false)}
        >
          <Outlet />
        </main>

        <footer className="flex min-w-0 flex-wrap items-center gap-3 border-t border-ah-line px-6 py-[9px] text-[9px] leading-[14px] text-[#667085]">
          AgentHubEx
          <span>工作有边界，协作无阻碍。</span>
          <span className="ml-auto flex items-center gap-[7px]">
            <i className="inline-block h-1.5 w-1.5 rounded-full bg-[#12a16f]" />
            所有系统运行正常
            <span>·</span>
            内网部署 / 自托管静态资源
          </span>
        </footer>
      </div>
    </>
  );
}
