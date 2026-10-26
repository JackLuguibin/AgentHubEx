import { EmptyState } from "@agenthub/hub-ui-kit";
import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router";
import { Workbench } from "@agenthub/workbench";
import { useTenant } from "../auth/TenantProvider.js";
import { api, API_BASE, getAccessToken } from "../lib/api.js";

export function WorkbenchPage() {
  const { projectId: routeProjectId } = useParams();
  const { projectId: ctxProjectId, setProjectId, projects } = useTenant();
  const projectId = routeProjectId ?? ctxProjectId;
  const [params, setParams] = useSearchParams();
  const sessionParam = params.get("session");
  const project = projects.find((p) => p.id === projectId);

  useEffect(() => {
    if (routeProjectId && routeProjectId !== ctxProjectId) {
      setProjectId(routeProjectId);
    }
  }, [routeProjectId, ctxProjectId, setProjectId]);

  if (!projectId) {
    return <EmptyState surface>请先在「项目管理」中选择项目</EmptyState>;
  }

  return (
    <Workbench
      projectId={projectId}
      projectLabel={project ? `${project.key}` : "Project"}
      client={api}
      apiBase={API_BASE || window.location.origin}
      getAccessToken={getAccessToken}
      initialSessionId={sessionParam}
      onSessionChange={(id) => {
        const next = new URLSearchParams(params);
        if (id) next.set("session", id);
        else next.delete("session");
        setParams(next, { replace: true });
      }}
    />
  );
}
