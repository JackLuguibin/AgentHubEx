import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AuthProvider, useAuth } from "./auth/AuthProvider.js";
import { TenantProvider } from "./auth/TenantProvider.js";
import { ShellLayout } from "./layout/ShellLayout.js";
import { HomePage } from "./pages/HomePage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { BoardPage } from "./pages/BoardPage.js";
import { ConfigPage } from "./pages/ConfigPage.js";
import { CredentialsPage } from "./pages/CredentialsPage.js";
import { FilesPage } from "./pages/FilesPage.js";
import { InstancesPage } from "./pages/InstancesPage.js";
import { MembersPage } from "./pages/MembersPage.js";
import { NodesPage } from "./pages/NodesPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { TenantsPage } from "./pages/TenantsPage.js";
import { WorkbenchPage } from "./pages/WorkbenchPage.js";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="grid min-h-full place-items-center text-[11px] text-[color:var(--muted)]">加载中…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <TenantProvider>
                <ShellLayout />
              </TenantProvider>
            </RequireAuth>
          }
        >
          <Route index element={<HomePage />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="t/:tenantId/projects" element={<ProjectsPage />} />
          <Route path="p/:projectId/overview" element={<OverviewPage />} />
          <Route path="p/:projectId/board" element={<BoardPage />} />
          <Route path="p/:projectId/issues/:issueKey" element={<BoardPage />} />
          <Route path="p/:projectId/workbench" element={<WorkbenchPage />} />
          <Route path="p/:projectId/instances" element={<InstancesPage />} />
          <Route path="p/:projectId/config" element={<ConfigPage />} />
          <Route path="p/:projectId/files" element={<FilesPage />} />
          <Route path="p/:projectId/files/*" element={<FilesPage />} />
          <Route path="p/:projectId/members" element={<MembersPage />} />
          <Route path="p/:projectId/credentials" element={<CredentialsPage />} />
          <Route path="p/:projectId/nodes" element={<NodesPage />} />
          <Route path="p/:projectId/audit" element={<AuditPage />} />
          <Route path="p/:projectId/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
