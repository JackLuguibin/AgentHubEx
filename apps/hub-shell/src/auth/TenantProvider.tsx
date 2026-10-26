import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@agenthub/domain";
import { api, setAccessToken } from "../lib/api.js";
import { filterSwitcherProjects } from "../lib/space-availability.js";
import { useAuth } from "./AuthProvider.js";

type TenantContextValue = {
  tenantId: string | null;
  /** Active (non-archived) projects the user can access under current tenant. */
  projects: Project[];
  /** All projects including archived (for management page). */
  allProjects: Project[];
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  switchTenant: (tenantId: string) => Promise<void>;
  loadingProjects: boolean;
  refreshProjects: () => Promise<void>;
};

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, refreshMe } = useAuth();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(null);

  const tenantId = user?.currentTenantId ?? user?.tenants[0]?.id ?? null;
  const tenantStatus =
    user?.tenants.find((t) => t.id === tenantId)?.status ??
    (tenantId ? "active" : null);

  const projectsQuery = useQuery({
    queryKey: ["projects", tenantId, "active"],
    enabled: Boolean(tenantId) && tenantStatus === "active",
    queryFn: async () => {
      const page = await api.listProjects(tenantId!);
      return page.items;
    },
  });

  const archivedQuery = useQuery({
    queryKey: ["projects", tenantId, "archived"],
    enabled: Boolean(tenantId) && tenantStatus === "active",
    queryFn: async () => {
      const page = await api.listProjects(tenantId!, { archived: true });
      return page.items;
    },
  });

  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );

  const allProjects = useMemo(
    () => [...(projectsQuery.data ?? []), ...(archivedQuery.data ?? [])],
    [projectsQuery.data, archivedQuery.data],
  );

  const switchable = useMemo(() => filterSwitcherProjects(projects), [projects]);

  useEffect(() => {
    if (!tenantId || tenantStatus !== "active") {
      setProjectId(null);
      return;
    }
    setProjectId((prev) => {
      if (prev && switchable.some((p) => p.id === prev)) return prev;
      return switchable[0]?.id ?? null;
    });
  }, [tenantId, tenantStatus, switchable]);

  const switchTenant = useCallback(
    async (next: string) => {
      const res = await api.switchTenant(next);
      setAccessToken(res.accessToken);
      setProjectId(null);
      await refreshMe();
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    [queryClient, refreshMe],
  );

  const refreshProjects = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects", tenantId, "active"] }),
      queryClient.invalidateQueries({ queryKey: ["projects", tenantId, "archived"] }),
    ]);
  }, [queryClient, tenantId]);

  const loadingProjects =
    Boolean(tenantId) &&
    tenantStatus === "active" &&
    (projectsQuery.isLoading || projectsQuery.isFetching) &&
    !projectsQuery.data;

  const value = useMemo(
    () => ({
      tenantId,
      projects,
      allProjects,
      projectId,
      setProjectId,
      switchTenant,
      loadingProjects,
      refreshProjects,
    }),
    [
      tenantId,
      projects,
      allProjects,
      projectId,
      switchTenant,
      loadingProjects,
      refreshProjects,
    ],
  );

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant outside TenantProvider");
  return ctx;
}
