import { EmptyState } from "@agenthub/hub-ui-kit";
import { Navigate } from "react-router";
import { useTenant } from "../auth/TenantProvider.js";

/** Default landing: project overview when bound, otherwise projects list. */
export function HomePage() {
  const { projectId, loadingProjects } = useTenant();
  if (loadingProjects) {
    return <EmptyState surface>加载中…</EmptyState>;
  }
  if (projectId) {
    return <Navigate to={`/p/${projectId}/overview`} replace />;
  }
  return <Navigate to="/projects" replace />;
}
