import { EmptyState } from "@agenthub/hub-ui-kit";
import { Navigate } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { useTenant } from "../auth/TenantProvider.js";
import {
  filterSwitcherProjects,
  filterSwitcherTenants,
} from "../lib/space-availability.js";

/** Default landing: project overview when bound, otherwise projects list. */
export function HomePage() {
  const { user } = useAuth();
  const { tenantId, projects, projectId, loadingProjects } = useTenant();
  if (loadingProjects) {
    return <EmptyState surface>加载中…</EmptyState>;
  }
  const usableTenants = filterSwitcherTenants(user?.tenants ?? []);
  const usableProjects = filterSwitcherProjects(projects);
  if (
    projectId &&
    usableProjects.some((p) => p.id === projectId) &&
    usableTenants.some((t) => t.id === tenantId)
  ) {
    return <Navigate to={`/p/${projectId}/overview`} replace />;
  }
  if (tenantId && usableTenants.some((t) => t.id === tenantId)) {
    return <Navigate to={`/t/${tenantId}/projects`} replace />;
  }
  if (usableTenants.length === 0) {
    return <Navigate to="/tenants" replace />;
  }
  return <Navigate to="/projects" replace />;
}
