import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setAccessToken } from "../lib/api.js";
import { useAuth } from "./AuthProvider.js";

type Project = { id: string; key: string; name: string };

type TenantContextValue = {
  tenantId: string | null;
  projects: Project[];
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  switchTenant: (tenantId: string) => Promise<void>;
  loadingProjects: boolean;
};

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, refreshMe } = useAuth();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const tenantId = user?.currentTenantId ?? user?.tenants[0]?.id ?? null;
  // Avoid HomePage racing ahead before the first projects fetch starts.
  const [loadingProjects, setLoadingProjects] = useState(() => Boolean(tenantId));

  useEffect(() => {
    if (!tenantId) {
      setProjects([]);
      setProjectId(null);
      setLoadingProjects(false);
      return;
    }
    let cancelled = false;
    setLoadingProjects(true);
    void api
      .listProjects(tenantId)
      .then((page) => {
        if (cancelled) return;
        setProjects(page.items);
        setProjectId((prev) => prev ?? page.items[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const switchTenant = async (next: string) => {
    const res = await api.switchTenant(next);
    setAccessToken(res.accessToken);
    await refreshMe();
  };

  const value = useMemo(
    () => ({
      tenantId,
      projects,
      projectId,
      setProjectId,
      switchTenant,
      loadingProjects,
    }),
    [tenantId, projects, projectId, loadingProjects],
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
