import { fetchEventSource } from "@microsoft/fetch-event-source";
import type {
  AgentSession,
  CreateProjectReq,
  CreateTenantReq,
  Me,
  PatchProjectReq,
  PatchTenantReq,
  Project,
  Tenant,
  TenantMember,
  Workspace,
} from "@agenthub/domain";
import type { Envelope } from "@agenthub/runtime-contract";
import type { KyInstance } from "ky";

export type Page<T> = { items: T[]; nextCursor: string | null };

export type CreateSessionInput = {
  title?: string;
  credentialSource?: "user" | "project";
  credentialId?: string;
  issueId?: string;
  initialPrompt?: string;
};

export type SendMessageInput = {
  parts: Array<{ type: "text"; text: string }>;
  model?: string;
  agent?: string;
};

export function createFacadeClient(http: KyInstance) {
  return {
    async login(email: string, password: string) {
      return http
        .post("v1/auth/login", { json: { email, password } })
        .json<{ accessToken: string; expiresIn: number; user: Me }>();
    },

    async me() {
      return http.get("v1/me").json<Me>();
    },

    async listAdminTenants() {
      return http.get("v1/admin/tenants").json<Page<Tenant>>();
    },

    /** @deprecated Prefer listAdminTenants for platform admin or Me.tenants for memberships. */
    async listTenants() {
      return this.listAdminTenants();
    },

    async createTenant(input: CreateTenantReq) {
      return http.post("v1/admin/tenants", { json: input }).json<Tenant>();
    },

    async getTenant(tenantId: string) {
      return http.get(`v1/tenants/${tenantId}`).json<Tenant>();
    },

    async patchTenant(tenantId: string, input: PatchTenantReq) {
      return http.patch(`v1/tenants/${tenantId}`, { json: input }).json<Tenant>();
    },

    async suspendTenant(tenantId: string, reason?: string) {
      return http
        .post(`v1/admin/tenants/${tenantId}/suspend`, {
          json: reason ? { reason } : {},
        })
        .json<Tenant>();
    },

    async unsuspendTenant(tenantId: string) {
      return http.post(`v1/admin/tenants/${tenantId}/unsuspend`).json<Tenant>();
    },

    async listTenantMembers(tenantId: string) {
      return http.get(`v1/tenants/${tenantId}/members`).json<Page<TenantMember>>();
    },

    async listProjects(
      tenantId: string,
      opts: { archived?: boolean; q?: string } = {},
    ) {
      const searchParams = new URLSearchParams();
      if (opts.archived) searchParams.set("archived", "true");
      if (opts.q) searchParams.set("q", opts.q);
      const qs = searchParams.toString();
      return http
        .get(`v1/tenants/${tenantId}/projects${qs ? `?${qs}` : ""}`)
        .json<Page<Project>>();
    },

    async createProject(tenantId: string, input: CreateProjectReq) {
      return http
        .post(`v1/tenants/${tenantId}/projects`, { json: input })
        .json<Project>();
    },

    async getProject(projectId: string) {
      return http.get(`v1/projects/${projectId}`).json<Project>();
    },

    async patchProject(projectId: string, input: PatchProjectReq) {
      return http.patch(`v1/projects/${projectId}`, { json: input }).json<Project>();
    },

    async archiveProject(projectId: string) {
      return http.post(`v1/projects/${projectId}/archive`).json<Project>();
    },

    async unarchiveProject(projectId: string) {
      return http.post(`v1/projects/${projectId}/unarchive`).json<Project>();
    },

    async switchTenant(tenantId: string) {
      return http
        .post("v1/auth/switch-tenant", { json: { tenantId } })
        .json<{ accessToken: string; expiresIn: number; user: Me }>();
    },

    async refresh() {
      return http
        .post("v1/auth/refresh")
        .json<{ accessToken: string; expiresIn: number; user: Me }>();
    },

    async logout() {
      await http.post("v1/auth/logout");
    },

    async getWorkspaceMe(projectId: string) {
      return http.get(`v1/projects/${projectId}/workspaces/me`).json<Workspace>();
    },

    async listSessions(projectId: string) {
      return http
        .get(`v1/projects/${projectId}/sessions`)
        .json<Page<AgentSession>>();
    },

    async createSession(projectId: string, input: CreateSessionInput = {}) {
      return http
        .post(`v1/projects/${projectId}/sessions`, { json: input })
        .json<AgentSession>();
    },

    async getSession(sessionId: string) {
      return http.get(`v1/sessions/${sessionId}`).json<AgentSession>();
    },

    async sendMessage(sessionId: string, input: SendMessageInput) {
      return http
        .post(`v1/sessions/${sessionId}/messages`, { json: input })
        .json<{ messageId: string }>();
    },

    async listMessages(sessionId: string) {
      return http
        .get(`v1/sessions/${sessionId}/messages`)
        .json<
          Page<{
            id: string;
            role: "user" | "assistant";
            parts: unknown[];
            createdAt: string;
          }>
        >();
    },

    subscribeSessionEvents(
      sessionId: string,
      handlers: {
        getAccessToken: () => string | null;
        onEvent: (envelope: Envelope) => void;
        onError?: (err: unknown) => void;
        onOpen?: () => void;
        signal?: AbortSignal;
        lastEventId?: string;
        baseUrl: string;
      },
    ) {
      const url = `${handlers.baseUrl.replace(/\/$/, "")}/v1/sessions/${sessionId}/events`;
      return fetchEventSource(url, {
        method: "GET",
        credentials: "include",
        signal: handlers.signal,
        headers: {
          ...(handlers.getAccessToken()
            ? { authorization: `Bearer ${handlers.getAccessToken()}` }
            : {}),
          ...(handlers.lastEventId ? { "Last-Event-ID": handlers.lastEventId } : {}),
        },
        async onopen(res) {
          if (!res.ok) throw new Error(`SSE open failed: ${res.status}`);
          handlers.onOpen?.();
        },
        onmessage(msg) {
          if (!msg.data || msg.data.startsWith(":")) return;
          try {
            const envelope = JSON.parse(msg.data) as Envelope;
            handlers.onEvent(envelope);
          } catch (err) {
            handlers.onError?.(err);
          }
        },
        onerror(err) {
          handlers.onError?.(err);
          throw err;
        },
      });
    },
  };
}

export type FacadeClient = ReturnType<typeof createFacadeClient>;
