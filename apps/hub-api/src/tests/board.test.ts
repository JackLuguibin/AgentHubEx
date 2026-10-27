import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, users } from "@agenthub/db";
import { eq, sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { createApp } from "../app.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://agenthub:agenthub@localhost:5432/agenthub";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

async function truncateAll(db: ReturnType<typeof createDb>) {
  await db.execute(sql.raw(`
    TRUNCATE TABLE
      agent_sessions,
      workspaces,
      project_issues,
      project_runtime_bindings,
      runtime_instances,
      credential_versions,
      project_credentials,
      user_credentials,
      hub_api_keys,
      project_memberships,
      projects,
      tenant_memberships,
      tenants,
      users
    RESTART IDENTITY CASCADE
  `));
}

describe("P1-07 project board", () => {
  const db = createDb(DATABASE_URL);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const { app } = createApp({
    db,
    redis,
    envOverrides: { RUNTIME_MOCK: true },
  });

  beforeAll(async () => {
    await truncateAll(db);
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function json(path: string, init: RequestInit & { token?: string } = {}) {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("content-type", "application/json");
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    const res = await app.request(path, { ...init, headers });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    return { res, body };
  }

  it("moves three cards, opens a session from PROJ-1, and hides the session body from others", async () => {
    const ownerReg = await json("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "board-owner@example.com",
        password: "password-owner-1",
        displayName: "Owner",
        handle: "board-owner",
      }),
    });
    expect(ownerReg.res.status).toBe(201);
    await db
      .update(users)
      .set({ isPlatformAdmin: true })
      .where(eq(users.email, "board-owner@example.com"));
    const ownerLogin = await json("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "board-owner@example.com",
        password: "password-owner-1",
      }),
    });
    let ownerToken = ownerLogin.body.accessToken as string;

    const tenant = await json("/v1/admin/tenants", {
      method: "POST",
      token: ownerToken,
      body: JSON.stringify({
        slug: "board-co",
        name: "Board Co",
        ownerEmail: "board-owner@example.com",
      }),
    });
    expect(tenant.res.status).toBe(201);
    const switched = await json("/v1/auth/switch-tenant", {
      method: "POST",
      token: ownerToken,
      body: JSON.stringify({ tenantId: tenant.body.id }),
    });
    ownerToken = switched.body.accessToken as string;

    const project = await json(`/v1/tenants/${tenant.body.id}/projects`, {
      method: "POST",
      token: ownerToken,
      body: JSON.stringify({ key: "PROJ", name: "Board Project" }),
    });
    expect(project.res.status).toBe(201);
    const projectId = project.body.id as string;

    async function registerMember(email: string, handle: string, name: string, role: string) {
      const reg = await json("/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email,
          password: "password-member-1",
          displayName: name,
          handle,
        }),
      });
      expect(reg.res.status).toBe(201);
      const added = await json(`/v1/projects/${projectId}/members`, {
        method: "POST",
        token: ownerToken,
        body: JSON.stringify({ email, role }),
      });
      expect(added.res.status).toBe(201);
      const login = await json("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password: "password-member-1" }),
      });
      expect(login.res.status).toBe(200);
      return login.body.accessToken as string;
    }

    const devToken = await registerMember(
      "board-dev@example.com",
      "board-dev",
      "Dev",
      "developer",
    );
    const peerToken = await registerMember(
      "board-peer@example.com",
      "board-peer",
      "Peer",
      "developer",
    );
    const viewerToken = await registerMember(
      "board-view@example.com",
      "board-view",
      "Viewer",
      "viewer",
    );

    const viewerCreate = await json(`/v1/projects/${projectId}/issues`, {
      method: "POST",
      token: viewerToken,
      body: JSON.stringify({ title: "viewer cannot create" }),
    });
    expect(viewerCreate.res.status).toBe(403);

    const titles = ["登录白屏", "拖到进行中", "拖到评审"];
    const created = [];
    for (const title of titles) {
      const issue = await json(`/v1/projects/${projectId}/issues`, {
        method: "POST",
        token: devToken,
        body: JSON.stringify({ title, description: "卡片描述", priority: "P1" }),
      });
      expect(issue.res.status).toBe(201);
      expect(issue.body.linkedSessions).toEqual([]);
      created.push(issue.body);
    }
    expect(created[0].key).toBe("PROJ-1");

    const ac = new AbortController();
    let buf = "";
    const sawUpdate = (async () => {
      const res = await app.request(`/v1/projects/${projectId}/board/events`, {
        headers: { authorization: `Bearer ${peerToken}` },
        signal: ac.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes("issue.upserted") && buf.includes(created[1].id as string)) return true;
      }
      return false;
    })();
    const readyDeadline = Date.now() + 4000;
    while (!buf.includes("board.resync") && Date.now() < readyDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(buf).toContain("board.resync");

    const movedProgress = await json(`/v1/issues/${created[1].id}`, {
      method: "PATCH",
      token: devToken,
      headers: { "if-match": created[1].etag },
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(movedProgress.res.status).toBe(200);
    expect(movedProgress.body.status).toBe("in_progress");

    const movedReview = await json(`/v1/issues/${created[2].id}`, {
      method: "PATCH",
      token: devToken,
      headers: { "if-match": created[2].etag },
      body: JSON.stringify({ status: "in_review", resolutionNote: "开发者已自测" }),
    });
    expect(movedReview.res.status).toBe(422);

    const started = await json(`/v1/issues/${created[2].id}`, {
      method: "PATCH",
      token: devToken,
      headers: { "if-match": created[2].etag },
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(started.res.status).toBe(200);
    const reviewed = await json(`/v1/issues/${created[2].id}`, {
      method: "PATCH",
      token: devToken,
      headers: { "if-match": started.body.etag },
      body: JSON.stringify({ status: "in_review", resolutionNote: "请验收登录页" }),
    });
    expect(reviewed.res.status).toBe(200);
    expect(reviewed.body.resolutionNote).toBe("请验收登录页");

    const peerClose = await json(`/v1/issues/${created[1].id}`, {
      method: "PATCH",
      token: peerToken,
      headers: { "if-match": movedProgress.body.etag },
      body: JSON.stringify({ status: "done", resolutionNote: "别人想关掉" }),
    });
    expect(peerClose.res.status).toBe(403);

    const missingNote = await json(`/v1/issues/${created[1].id}`, {
      method: "PATCH",
      token: devToken,
      headers: { "if-match": movedProgress.body.etag },
      body: JSON.stringify({ status: "done" }),
    });
    expect(missingNote.res.status).toBe(422);

    const forced = await json(`/v1/issues/${created[0].id}`, {
      method: "PATCH",
      token: ownerToken,
      headers: { "if-match": created[0].etag },
      body: JSON.stringify({ status: "done", resolutionNote: "owner 强制关闭" }),
    });
    expect(forced.res.status).toBe(200);
    expect(forced.body.status).toBe("done");
    const reopened = await json(`/v1/issues/${created[0].id}`, {
      method: "PATCH",
      token: ownerToken,
      headers: { "if-match": forced.body.etag },
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(reopened.res.status).toBe(200);
    const backToTodo = await json(`/v1/issues/${created[0].id}`, {
      method: "PATCH",
      token: devToken,
      headers: { "if-match": reopened.body.etag },
      body: JSON.stringify({ status: "todo" }),
    });
    expect(backToTodo.res.status).toBe(200);

    expect(await sawUpdate).toBe(true);
    ac.abort();

    const board = await json(
      `/v1/projects/${projectId}/board?includeCancelled=true`,
      { token: peerToken },
    );
    expect(board.res.status).toBe(200);
    const counts = Object.fromEntries(
      board.body.columns.map((column: { status: string; total: number }) => [
        column.status,
        column.total,
      ]),
    );
    expect(counts).toMatchObject({ todo: 1, in_progress: 1, in_review: 1, done: 0 });

    const cred = await json("/v1/me/credentials", {
      method: "POST",
      token: devToken,
      body: JSON.stringify({
        provider: "opencode",
        label: "dev-key",
        secret: "sk-test-board",
      }),
    });
    expect(cred.res.status).toBe(201);

    const secret = "SESSION_BODY_SECRET_9f3a";
    const session = await json(`/v1/projects/${projectId}/sessions`, {
      method: "POST",
      token: devToken,
      body: JSON.stringify({
        issueId: created[0].id,
        initialPrompt: secret,
      }),
    });
    expect(session.res.status).toBe(201);
    expect(session.body.title).toContain("PROJ-1");
    expect(session.body.issue.key).toBe("PROJ-1");
    expect(session.body.issue.status).toBe("in_progress");

    const linked = await json(`/v1/issues/${created[0].key}`, { token: devToken });
    expect(linked.res.status).toBe(200);
    expect(linked.body.status).toBe("in_progress");
    expect(linked.body.assignee.displayName).toBe("Dev");
    expect(linked.body.linkedSessions).toEqual([
      expect.objectContaining({
        id: session.body.id,
        canOpen: true,
        ownerName: "Dev",
      }),
    ]);

    const hidden = await json(`/v1/issues/PROJ-1`, { token: peerToken });
    expect(hidden.res.status).toBe(200);
    expect(JSON.stringify(hidden.body)).not.toContain(secret);
    expect(hidden.body.linkedSessions[0].canOpen).toBe(false);
    expect(hidden.body.linkedSessions[0].ownerName).toBe("Dev");
    expect(hidden.body.linkedSessions[0].title).toContain("PROJ-1");

    const viewerView = await json(`/v1/issues/PROJ-1`, { token: viewerToken });
    expect(viewerView.res.status).toBe(200);
    expect(viewerView.body.linkedSessions[0].canOpen).toBe(false);
    expect(JSON.stringify(viewerView.body)).not.toContain(secret);

    const peerMessages = await json(`/v1/sessions/${session.body.id}/messages`, {
      token: peerToken,
    });
    expect(peerMessages.res.status).toBe(404);

    const ownMessages = await json(`/v1/sessions/${session.body.id}/messages`, {
      token: devToken,
    });
    expect(ownMessages.res.status).toBe(200);
    expect(JSON.stringify(ownMessages.body)).toContain(secret);

    const after = await json(`/v1/projects/${projectId}/board`, { token: peerToken });
    const afterCounts = Object.fromEntries(
      after.body.columns.map((column: { status: string; total: number }) => [
        column.status,
        column.total,
      ]),
    );
    expect(afterCounts).toMatchObject({ todo: 0, in_progress: 2, in_review: 1 });
  });
});
