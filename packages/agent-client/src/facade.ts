import { fetchEventSource } from "@microsoft/fetch-event-source";
import type {
  AgentSession,
  ApplyConfigReq,
  ApplyJob,
  Bundle,
  ConfigLock,
  CreateBundleReq,
  CreateInvitationReq,
  CreateProjectReq,
  CreateTenantReq,
  CommonEntry,
  CommonSettings,
  CommonTree,
  DirectoryUser,
  CredentialOptionsRes,
  EffectiveConfig,
  ImportSkillReq,
  Invitation,
  Issue,
  IssueStatus,
  Board,
  CreateIssueReq,
  UpdateIssueReq,
  Manifest,
  Me,
  PatchInstanceReq,
  PatchProjectReq,
  PatchTenantReq,
  Project,
  ProjectMember,
  ProjectRuntimeBinding,
  PutProjectBindingsReq,
  PutUserBindingsReq,
  RegisterInstanceReq,
  Revision,
  RuntimeInstance,
  SkillRef,
  Tenant,
  TenantMember,
  TestInstanceReq,
  TestInstanceRes,
  UserBindings,
  Workspace,
} from "@agenthub/domain";
import type { Envelope } from "@agenthub/runtime-contract";
import type { KyInstance } from "ky";

export type Page<T> = { items: T[]; nextCursor: string | null };

export type CreateSessionInput = {
  title?: string;
  runtimeType?: "opencode" | "claude";
  credentialSource?: "user" | "project";
  credentialId?: string;
  issueId?: string;
  initialPrompt?: string;
};

export type IssueListQuery = {
  status?: IssueStatus;
  assignee?: string;
  label?: string;
  priority?: "P0" | "P1" | "P2" | "P3";
  q?: string;
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

    async addTenantMember(tenantId: string, input: { email: string; role: string }) {
      return http
        .post(`v1/tenants/${tenantId}/members`, { json: input })
        .json<TenantMember>();
    },

    async removeTenantMember(tenantId: string, userId: string) {
      await http.delete(`v1/tenants/${tenantId}/members/${userId}`);
    },

    async createInvitation(tenantId: string, input: CreateInvitationReq) {
      return http
        .post(`v1/tenants/${tenantId}/invitations`, { json: input })
        .json<Invitation>();
    },

    async listDirectoryUsers(opts: { tenantId?: string; q?: string } = {}) {
      const searchParams = new URLSearchParams();
      if (opts.tenantId) searchParams.set("tenantId", opts.tenantId);
      if (opts.q) searchParams.set("q", opts.q);
      const qs = searchParams.toString();
      return http
        .get(`v1/directory/users${qs ? `?${qs}` : ""}`)
        .json<Page<DirectoryUser>>();
    },

    async listBindingCatalog() {
      return http.get("v1/bindings/catalog").json<{
        items: Array<{
          tenantId: string;
          name: string;
          slug: string;
          status: "active" | "suspended";
          canEdit: boolean;
          projects: Array<{
            projectId: string;
            name: string;
            key: string;
            archivedAt: string | null;
          }>;
        }>;
      }>();
    },

    async getUserBindings(userId: string) {
      return http.get(`v1/users/${userId}/bindings`).json<UserBindings>();
    },

    async putUserBindings(userId: string, input: PutUserBindingsReq) {
      return http.put(`v1/users/${userId}/bindings`, { json: input }).json<UserBindings>();
    },

    async listProjectMembers(projectId: string) {
      return http.get(`v1/projects/${projectId}/members`).json<Page<ProjectMember>>();
    },

    async addProjectMember(
      projectId: string,
      input: { userId?: string; email?: string; role: string },
    ) {
      return http
        .post(`v1/projects/${projectId}/members`, { json: input })
        .json<ProjectMember>();
    },

    async patchProjectMember(projectId: string, userId: string, role: string) {
      return http
        .patch(`v1/projects/${projectId}/members/${userId}`, { json: { role } })
        .json<ProjectMember>();
    },

    async removeProjectMember(projectId: string, userId: string) {
      await http.delete(`v1/projects/${projectId}/members/${userId}`);
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

    async getWorkspaceMe(projectId: string, runtimeType?: "opencode" | "claude") {
      const qs = runtimeType ? `?runtimeType=${runtimeType}` : "";
      return http.get(`v1/projects/${projectId}/workspaces/me${qs}`).json<Workspace>();
    },

    async listInstances(tenantId: string) {
      return http
        .get(`v1/tenants/${tenantId}/instances`)
        .json<Page<RuntimeInstance>>();
    },

    async testInstance(tenantId: string, input: TestInstanceReq) {
      return http
        .post(`v1/tenants/${tenantId}/instances/test`, { json: input })
        .json<TestInstanceRes>();
    },

    async registerInstance(tenantId: string, input: RegisterInstanceReq) {
      return http
        .post(`v1/tenants/${tenantId}/instances`, { json: input })
        .json<RuntimeInstance>();
    },

    async patchInstance(instanceId: string, input: PatchInstanceReq) {
      return http
        .patch(`v1/instances/${instanceId}`, { json: input })
        .json<RuntimeInstance>();
    },

    async probeInstance(instanceId: string) {
      return http.post(`v1/instances/${instanceId}/probe`).json<RuntimeInstance>();
    },

    async deleteInstance(instanceId: string) {
      await http.delete(`v1/instances/${instanceId}`);
    },

    async getProjectBindings(projectId: string) {
      return http
        .get(`v1/projects/${projectId}/bindings`)
        .json<{ bindings: ProjectRuntimeBinding[] }>();
    },

    async putProjectBindings(projectId: string, input: PutProjectBindingsReq) {
      return http
        .put(`v1/projects/${projectId}/bindings`, { json: input })
        .json<{ bindings: ProjectRuntimeBinding[] }>();
    },

    /** Channel B (04 §4.2): allowlisted agent paths, e.g. `file?path=/`. */
    async agentGet<T = unknown>(workspaceId: string, upstreamPath: string) {
      const path = upstreamPath.replace(/^\/+/, "");
      return http.get(`v1/workspaces/${workspaceId}/agent/${path}`).json<T>();
    },

    async agentPut<T = unknown>(workspaceId: string, upstreamPath: string, jsonBody: unknown) {
      const path = upstreamPath.replace(/^\/+/, "");
      return http.put(`v1/workspaces/${workspaceId}/agent/${path}`, { json: jsonBody }).json<T>();
    },

    /** Opens a capability-gated terminal. The socket stays on the Hub. */
    async openPty(
      workspaceId: string,
      handlers: {
        baseUrl: string;
        cols: number;
        rows: number;
        onData: (chunk: string) => void;
        onClose: () => void;
      },
    ) {
      const opened = await http
        .post(`v1/workspaces/${workspaceId}/pty/open`, {
          json: { cols: handlers.cols, rows: handlers.rows },
        })
        .json<{ ptyId: string; ticket: string; expiresIn: number }>();
      const ws = new WebSocket(ptyConnectUrl(handlers.baseUrl, workspaceId, opened.ticket));
      ws.binaryType = "arraybuffer";
      let openedSocket = false;
      const ready = new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          openedSocket = true;
          resolve();
        };
        ws.onerror = () => {
          if (!openedSocket) reject(new Error("终端连接失败"));
        };
      });
      ws.onmessage = (event) => {
        const data = event.data;
        if (typeof data === "string") handlers.onData(data);
        else if (data instanceof ArrayBuffer) handlers.onData(new TextDecoder().decode(data));
      };
      ws.onclose = () => handlers.onClose();
      await ready;
      return {
        send(data: string) {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        },
        close() {
          ws.close();
        },
      };
    },

    async listCredentialOptions(projectId: string) {
      return http
        .get(`v1/projects/${projectId}/credentials/options`)
        .json<CredentialOptionsRes>();
    },

    async getBoard(projectId: string, query: IssueListQuery & { includeCancelled?: boolean } = {}) {
      const search = issueSearchParams(query);
      if (query.includeCancelled) search.set("includeCancelled", "true");
      const qs = search.toString();
      return http.get(`v1/projects/${projectId}/board${qs ? `?${qs}` : ""}`).json<Board>();
    },

    async listIssues(projectId: string, query: IssueListQuery = {}) {
      const qs = issueSearchParams(query).toString();
      return http
        .get(`v1/projects/${projectId}/issues${qs ? `?${qs}` : ""}`)
        .json<Page<Issue>>();
    },

    async createIssue(projectId: string, input: CreateIssueReq) {
      return http.post(`v1/projects/${projectId}/issues`, { json: input }).json<Issue>();
    },

    async getIssue(idOrKey: string) {
      return http.get(`v1/issues/${encodeURIComponent(idOrKey)}`).json<Issue>();
    },

    async updateIssue(idOrKey: string, input: UpdateIssueReq, etag?: string) {
      return http
        .patch(`v1/issues/${encodeURIComponent(idOrKey)}`, {
          json: input,
          headers: etag ? { "if-match": etag } : undefined,
        })
        .json<Issue>();
    },

    subscribeBoardEvents(
      projectId: string,
      handlers: {
        getAccessToken: () => string | null;
        onEvent: (event: { event: string }) => void;
        onError?: (err: unknown) => void;
        signal?: AbortSignal;
        baseUrl: string;
      },
    ) {
      const url = boardEventsUrl(handlers.baseUrl, projectId);
      return fetchEventSource(url, {
        method: "GET",
        credentials: "include",
        signal: handlers.signal,
        headers: handlers.getAccessToken()
          ? { authorization: `Bearer ${handlers.getAccessToken()}` }
          : {},
        async onopen(res) {
          if (!res.ok) throw new Error(`SSE open failed: ${res.status}`);
        },
        onmessage(msg) {
          if (!msg.event || msg.event.startsWith("ping")) return;
          handlers.onEvent({ event: msg.event });
        },
        onerror(err) {
          handlers.onError?.(err);
          throw err;
        },
      });
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

    async patchSession(sessionId: string, input: { title: string }) {
      return http.patch(`v1/sessions/${sessionId}`, { json: input }).json<AgentSession>();
    },

    async archiveSession(sessionId: string) {
      await http.delete(`v1/sessions/${sessionId}`);
    },

    async abortSession(sessionId: string) {
      return http.post(`v1/sessions/${sessionId}/abort`).json<AgentSession>();
    },

    async respondPermission(
      sessionId: string,
      reqId: string,
      decision: "allow" | "deny" | "always",
    ) {
      await http.post(`v1/sessions/${sessionId}/permissions/${encodeURIComponent(reqId)}`, {
        json: { decision },
      });
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

    async listProjectBundles(projectId: string) {
      return http.get(`v1/projects/${projectId}/bundles`).json<Page<Bundle>>();
    },

    async createProjectBundle(projectId: string, input: CreateBundleReq) {
      return http.post(`v1/projects/${projectId}/bundles`, { json: input }).json<Bundle>();
    },

    async updateBundleDraft(bundleId: string, draft: Manifest, etag: string) {
      return http
        .put(`v1/bundles/${bundleId}/draft`, {
          json: draft,
          headers: { "If-Match": etag },
        })
        .json<Bundle>();
    },

    async publishBundle(bundleId: string, changelog?: string) {
      return http
        .post(`v1/bundles/${bundleId}/publish`, {
          json: { changelog },
          headers: { "Idempotency-Key": crypto.randomUUID() },
        })
        .json<Revision>();
    },

    async listBundleRevisions(bundleId: string) {
      return http.get(`v1/bundles/${bundleId}/revisions`).json<Page<Revision>>();
    },

    async rollbackBundle(bundleId: string, revisionId: string) {
      return http
        .post(`v1/bundles/${bundleId}/rollback`, { json: { revisionId } })
        .json<Revision>();
    },

    async importSkill(bundleId: string, input: ImportSkillReq) {
      return http.post(`v1/bundles/${bundleId}/skills/import`, { json: input }).json<SkillRef>();
    },

    async getEffectiveConfig(projectId: string) {
      return http.get(`v1/projects/${projectId}/config/effective`).json<EffectiveConfig>();
    },

    async getConfigLock(projectId: string) {
      return http.get(`v1/projects/${projectId}/config/lock`).json<ConfigLock>();
    },

    async putConfigLock(projectId: string, lock: ConfigLock) {
      return http.put(`v1/projects/${projectId}/config/lock`, { json: lock }).json<ConfigLock>();
    },

    async applyConfig(projectId: string, input: ApplyConfigReq = {}) {
      return http
        .post(`v1/projects/${projectId}/config/apply`, {
          json: input,
          headers: { "Idempotency-Key": crypto.randomUUID() },
        })
        .json<{ jobs: ApplyJob[] }>();
    },

    async listApplyJobs(projectId: string) {
      return http.get(`v1/projects/${projectId}/apply-jobs`).json<Page<ApplyJob>>();
    },

    async getCommonTree(projectId: string, prefix = "", depth = 1) {
      const query = new URLSearchParams({ depth: String(depth) });
      if (prefix) query.set("prefix", prefix);
      return http.get(`v1/projects/${projectId}/common/tree?${query}`).json<CommonTree>();
    },

    async searchCommonFiles(projectId: string, q: string) {
      return http
        .get(`v1/projects/${projectId}/common/search?q=${encodeURIComponent(q)}`)
        .json<Page<CommonEntry>>();
    },

    async putCommonSettings(
      projectId: string,
      input: Partial<Pick<CommonSettings, "quotaBytes" | "protectedPrefixes" | "syncPolicy">>,
    ) {
      return http.put(`v1/projects/${projectId}/common/settings`, { json: input }).json<CommonSettings>();
    },

    async createCommonDir(projectId: string, path: string) {
      return http.post(`v1/projects/${projectId}/common/dirs`, { json: { path } }).json<CommonEntry>();
    },

    async uploadCommonFiles(projectId: string, files: File[], prefix: string) {
      const form = new FormData();
      if (prefix) form.set("prefix", prefix);
      for (const file of files) form.append("files", file);
      return http
        .post(`v1/projects/${projectId}/common/upload`, {
          body: form,
          headers: { "idempotency-key": crypto.randomUUID() },
        })
        .json<{ entries: CommonEntry[] }>();
    },

    async putCommonText(projectId: string, path: string, content: string, mime = "text/plain") {
      return http
        .put(commonFileUrl(projectId, path), {
          body: content,
          headers: { "content-type": mime },
        })
        .json<CommonEntry>();
    },

    async readCommonFile(projectId: string, path: string) {
      const res = await http.get(commonFileUrl(projectId, path));
      const mime = res.headers.get("content-type") ?? "application/octet-stream";
      const checksum = (res.headers.get("etag") ?? "").replaceAll('"', "");
      const textual =
        mime.startsWith("text/") ||
        mime.includes("json") ||
        mime.includes("yaml") ||
        mime.includes("xml") ||
        mime.includes("javascript");
      if (textual) return { mime, checksum, text: await res.text(), blob: null as Blob | null };
      return { mime, checksum, text: null as string | null, blob: await res.blob() };
    },

    async listCommonVersions(projectId: string, path: string) {
      return http.get(`${commonFileUrl(projectId, path)}/versions`).json<{
        versions: { version: number; size: number; checksum: string; createdBy: string; createdAt: string }[];
      }>();
    },

    async restoreCommonVersion(projectId: string, path: string, version: number) {
      return http
        .post(`${commonFileUrl(projectId, path)}/restore`, { json: { version } })
        .json<CommonEntry>();
    },

    async deleteCommonFile(projectId: string, path: string) {
      await http.delete(`${commonFileUrl(projectId, path)}?recursive=1`);
    },

    async syncCommon(workspaceId: string) {
      return http
        .post(`v1/workspaces/${workspaceId}/sync-common`, {
          headers: { "idempotency-key": crypto.randomUUID() },
        })
        .json<ApplyJob>();
    },

    async saveOverlay(projectId: string, draft: Manifest) {
      return http.put(`v1/me/projects/${projectId}/overlay`, { json: draft }).json<Revision>();
    },

    subscribeSessionEvents(
      sessionId: string,
      handlers: {
        getAccessToken: () => string | null;
        onEvent: (envelope: Envelope) => void;
        onError?: (err: unknown) => void;
        onOpen?: () => void;
        onStale?: () => void;
        signal?: AbortSignal;
        lastEventId?: string;
        baseUrl: string;
      },
    ) {
      const url = sessionEventsUrl(handlers.baseUrl, sessionId);
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
          if (res.status === 409) {
            handlers.onStale?.();
            throw new Error("SSE_CURSOR_STALE");
          }
          if (!res.ok) throw new Error(`SSE open failed: ${res.status}`);
          handlers.onOpen?.();
        },
        onmessage(msg) {
          if (!msg.data || msg.data.startsWith(":")) return;
          try {
            const envelope = JSON.parse(msg.data) as Envelope;
            if (
              envelope.type === "error" &&
              (envelope.data as { code?: string }).code === "SSE_CURSOR_STALE"
            ) {
              handlers.onStale?.();
            }
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

/** Session event stream is Facade-only. Never `/agent/event`. */
export function sessionEventsUrl(baseUrl: string, sessionId: string) {
  return `${baseUrl.replace(/\/$/, "")}/v1/sessions/${sessionId}/events`;
}

export function boardEventsUrl(baseUrl: string, projectId: string) {
  return `${baseUrl.replace(/\/$/, "")}/v1/projects/${projectId}/board/events`;
}

/** Browser PTY socket. Ticket auth, Hub host, never the runtime node. */
export function ptyConnectUrl(baseUrl: string, workspaceId: string, ticket: string) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/v1/workspaces/${workspaceId}/pty/connect`;
  url.search = `?ticket=${encodeURIComponent(ticket)}`;
  url.hash = "";
  return url.toString();
}

function issueSearchParams(query: IssueListQuery) {
  const search = new URLSearchParams();
  if (query.status) search.set("status", query.status);
  if (query.assignee) search.set("assignee", query.assignee);
  if (query.label) search.set("label", query.label);
  if (query.priority) search.set("priority", query.priority);
  if (query.q) search.set("q", query.q);
  return search;
}

function commonFileUrl(projectId: string, path: string) {
  const encoded = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `v1/projects/${projectId}/common/files/${encoded}`;
}
