import { useMemo, useState } from "react";
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
  Search,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";
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
}: {
  label: string;
  hint?: string;
  items: NavItem[];
  projectId: string | null;
}) {
  return (
    <>
      <div className="mb-[11px] mx-3 flex justify-between text-[10px] tracking-[1px] text-[#96a098]">
        {label}
        {hint ? <span className="text-[8px] tracking-[0.5px]">{hint}</span> : null}
      </div>
      <nav className="mb-[22px] grid gap-1">
        {items.map((item) => {
          const to =
            item.scope === "platform"
              ? item.key === "projects"
                ? "/projects"
                : `/${item.key}`
              : projectId
                ? `/p/${projectId}/${item.key}`
                : "/projects";
          const Icon = item.icon;
          return (
            <NavLink
              key={item.key}
              to={to}
              end={item.scope === "platform"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-[7px] px-[13px] py-[11px] text-xs text-[#475467] no-underline hover:bg-[#f2f4f7]",
                  isActive && "bg-ah-accent-soft font-[650] text-ah-accent",
                )
              }
            >
              <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.6} />
              {item.label}
              {item.phase ? (
                <span className="ml-auto text-[9px] text-[#a0aaa1]">{item.phase}</span>
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
  const { tenantId, projects, projectId, setProjectId, switchTenant } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeProjectId = params.projectId ?? projectId;
  const tenant = user?.tenants.find((t) => t.id === tenantId) ?? user?.tenants[0];

  const crumb = useMemo(() => {
    const seg = location.pathname.split("/").filter(Boolean);
    const last = seg[seg.length - 1] ?? "";
    if (last in crumbLabels) return crumbLabels[last]!;
    if (seg[0] === "projects") return "项目管理";
    if (seg[0] === "tenants") return "租户管理";
    return "项目概览";
  }, [location.pathname]);

  const onProjectChange = (id: string) => {
    setProjectId(id);
    const page =
      location.pathname.match(/\/p\/[^/]+\/([^/?]+)/)?.[1] ?? "overview";
    navigate(`/p/${id}/${page}`);
  };

  return (
    <>
      <aside
        id="sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-20 flex h-dvh w-sidebar flex-col overflow-hidden border-r border-ah-line bg-white px-[18px] pb-4 pt-7 max-[960px]:w-[210px] max-[960px]:px-[13px] max-[960px]:pt-[22px]",
          "max-[680px]:w-sidebar max-[680px]:-translate-x-full max-[680px]:shadow-[8px_0_30px_#143a1e20] max-[680px]:transition-transform",
          sidebarOpen && "max-[680px]:translate-x-0",
        )}
      >
        <Link
          className="flex items-center gap-[9px] px-2 text-[21px] font-[750] tracking-[-0.8px] text-ah-text no-underline"
          to={activeProjectId ? `/p/${activeProjectId}/overview` : "/projects"}
        >
          <span className="relative inline-flex h-[31px] w-[29px] items-center justify-center rounded-lg bg-ah-accent text-[17px] text-white">
            a
            <Icon
              icon={ArrowUpRight}
              size="xs"
              className="absolute -top-[3px] right-px text-white"
            />
          </span>
          AgentHub
          <span className="-ml-[5px] rounded bg-[#f8fafc] px-1 py-[3px] text-[9px] tracking-[0.5px] text-[#475467]">
            EX
          </span>
        </Link>

        <button
          type="button"
          className="my-7 mb-6 flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] border border-ah-line bg-white px-2 py-3 text-left hover:bg-[#fafbfe]"
          onClick={() => {
            const list = user?.tenants ?? [];
            if (list.length < 2 || !tenantId) return;
            const idx = list.findIndex((t) => t.id === tenantId);
            const next = list[(idx + 1) % list.length]!;
            void switchTenant(next.id);
          }}
          title="切换租户"
        >
          <span className="grid h-[30px] w-[30px] place-items-center rounded-[7px] border border-ah-line bg-[#f8fafc] text-[11px] font-bold text-[#475467]">
            {(tenant?.name ?? "T").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-xs text-[#344054]">
              {tenant?.name ?? "未选择租户"}
            </strong>
            <small className="mt-1 block text-[10px] text-ah-muted">
              团队空间 · {tenant?.role ?? "—"}
            </small>
          </span>
          <Icon icon={ChevronDown} size="sm" className="text-ah-muted" />
        </button>

        <div
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 -mx-2 [scrollbar-width:thin]"
          aria-label="平台导航"
        >
          <NavGroup label="平台与组织" items={managementNav} projectId={activeProjectId} />
          <NavGroup label="工作空间" items={workspaceNav} projectId={activeProjectId} />
          <NavGroup
            label="项目配置"
            hint="OWNER"
            items={adminNav}
            projectId={activeProjectId}
          />
        </div>

        <div className="mt-3 shrink-0 border-t border-ah-line bg-white pt-3">
          <div className="rounded-lg border border-ah-line bg-[#f8fafc] p-[13px] text-[10px] text-[#475467]">
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
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-xs text-[#344054]">
                {user?.displayName}
              </strong>
              <small className="mt-1 block text-[10px] text-ah-muted">
                {user?.isPlatformAdmin ? "平台管理员" : (tenant?.role ?? "成员")}
              </small>
            </span>
            <Icon icon={MoreHorizontal} size="sm" className="text-ah-muted" />
          </button>
        </div>
      </aside>

      <div
        className={cn(
          "grid h-dvh min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] ml-sidebar",
          "max-[960px]:ml-[210px] max-[680px]:ml-0",
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
          <div className="flex min-w-0 items-center gap-3 text-[11px] text-[#667085]">
            <span>工作空间</span>
            <span>/</span>
            <select
              aria-label="切换项目"
              className="max-w-40 cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#344054]"
              value={activeProjectId ?? ""}
              onChange={(e) => onProjectChange(e.target.value)}
              disabled={projects.length === 0}
            >
              {projects.length === 0 ? (
                <option value="">无项目</option>
              ) : (
                projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key}
                  </option>
                ))
              )}
            </select>
            <span>/</span>
            <strong className="truncate font-medium text-[#344054]">{crumb}</strong>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <span className="rounded-[5px] border border-[#e5e9e4] px-2 py-[5px] text-[9px] tracking-[0.5px] text-[#8b958b] max-[680px]:hidden">
              P0 · SPA 联调
            </span>
            <button
              type="button"
              className="grid h-[30px] w-[26px] cursor-pointer place-items-center border-0 bg-transparent text-[#829087] hover:text-[#344054]"
              aria-label="全局搜索"
              title="Search（P1）"
            >
              <Icon icon={Search} size="md" />
            </button>
            <button
              type="button"
              className="relative grid h-[30px] w-[26px] cursor-pointer place-items-center border-0 bg-transparent text-[#829087] hover:text-[#344054]"
              aria-label="通知"
              title="通知（P1）"
            >
              <Icon icon={Bell} size="md" />
              <i className="absolute top-1.5 right-1 h-1 w-1 rounded-full bg-[#c89366]" />
            </button>
            <Avatar tone="green">{initials(user?.displayName ?? "AH")}</Avatar>
          </div>
        </header>

        <main
          className="flex min-h-0 min-w-0 flex-col gap-3 overflow-auto px-6 py-5 pb-4 max-[680px]:px-4 [&>*]:min-w-0 [&>*:not(.flex-1)]:shrink-0"
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
