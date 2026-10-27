import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  AgentSessionSchema,
  CreateSessionReqSchema,
  ErrorResSchema,
  PageSchema,
  SendMessageReqSchema,
  SendMessageResSchema,
  SessionMessageSchema,
  WorkspaceSchema,
} from "@agenthub/domain";
import { makeEnvelope, type Envelope } from "@agenthub/runtime-contract";
import { opencodeAdapter } from "@agenthub/adapter-opencode";
import type { AppEnv } from "../context.js";
import { requireAuth } from "../middleware/auth.js";
import {
  createSession,
  getSession,
  getWorkspaceMe,
  listMySessions,
  loadSessionRuntime,
  sendMessage,
  syncWorkspaceConfig,
} from "../services/sessions.js";

function openApiApp() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: {
              code: "VALIDATION_FAILED",
              message: "Validation failed",
              requestId: c.get("requestId") ?? "unknown",
              fieldErrors: result.error.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
              })),
            },
          },
          400,
        );
      }
    },
  });
}

const UuidParam = z.string().uuid();

export function sessionRoutes() {
  const app = openApiApp();
  app.use("*", requireAuth);

  app.openapi(
    createRoute({
      method: "get",
      path: "/projects/{projectId}/sessions",
      tags: ["sessions"],
      request: {
        params: z.object({ projectId: UuidParam }),
        query: z.object({
          status: z.string().optional(),
          issueId: UuidParam.optional(),
        }),
      },
      responses: {
        200: {
          content: { "application/json": { schema: PageSchema(AgentSessionSchema) } },
          description: "My sessions",
        },
      },
    }),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const query = c.req.valid("query");
      const p = c.get("principal")!;
      const page = await listMySessions(
        c.get("db"),
        projectId,
        p.userId,
        p.isPlatformAdmin,
        query,
      );
      return c.json(page, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/projects/{projectId}/sessions",
      tags: ["sessions"],
      request: {
        params: z.object({ projectId: UuidParam }),
        body: {
          content: { "application/json": { schema: CreateSessionReqSchema } },
          required: true,
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: AgentSessionSchema } },
          description: "Created",
        },
        409: {
          content: { "application/json": { schema: ErrorResSchema } },
          description: "Conflict",
        },
      },
    }),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const body = c.req.valid("json");
      const p = c.get("principal")!;
      const env = c.get("env");
      const session = await createSession(
        c.get("db"),
        projectId,
        p.userId,
        p.isPlatformAdmin,
        env.PLATFORM_DEK,
        env.RUNTIME_MOCK,
        body,
      );
      return c.json(session, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/projects/{projectId}/workspaces/me",
      tags: ["sessions"],
      request: {
        params: z.object({ projectId: UuidParam }),
        query: z.object({
          runtimeType: z.enum(["opencode", "claude"]).optional(),
        }),
      },
      responses: {
        200: {
          content: { "application/json": { schema: WorkspaceSchema } },
          description: "My workspace",
        },
        202: {
          content: { "application/json": { schema: WorkspaceSchema } },
          description: "Workspace provisioning",
        },
      },
    }),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const query = c.req.valid("query");
      const p = c.get("principal")!;
      const env = c.get("env");
      const ws = await getWorkspaceMe(
        c.get("db"),
        projectId,
        p.userId,
        p.isPlatformAdmin,
        env.PLATFORM_DEK,
        env.RUNTIME_MOCK,
        query.runtimeType,
      );
      const status = ws.status === "provisioning" ? 202 : 200;
      return c.json(ws, status);
    },
  );

  app.post("/workspaces/:w/sync-config", async (c) => {
    const p = c.get("principal")!;
    return c.json(
      await syncWorkspaceConfig(
        c.get("db"),
        c.req.param("w"),
        p.userId,
        p.isPlatformAdmin,
      ),
      202,
    );
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/sessions/{sessionId}",
      tags: ["sessions"],
      request: { params: z.object({ sessionId: UuidParam }) },
      responses: {
        200: {
          content: { "application/json": { schema: AgentSessionSchema } },
          description: "Session",
        },
      },
    }),
    async (c) => {
      const { sessionId } = c.req.valid("param");
      const p = c.get("principal")!;
      const session = await getSession(
        c.get("db"),
        sessionId,
        p.userId,
        p.isPlatformAdmin,
      );
      return c.json(session, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/sessions/{sessionId}/messages",
      tags: ["sessions"],
      request: {
        params: z.object({ sessionId: UuidParam }),
        body: {
          content: { "application/json": { schema: SendMessageReqSchema } },
          required: true,
        },
      },
      responses: {
        202: {
          content: { "application/json": { schema: SendMessageResSchema } },
          description: "Accepted",
        },
      },
    }),
    async (c) => {
      const { sessionId } = c.req.valid("param");
      const body = c.req.valid("json");
      const p = c.get("principal")!;
      const env = c.get("env");
      const result = await sendMessage(
        c.get("db"),
        sessionId,
        p.userId,
        p.isPlatformAdmin,
        env.PLATFORM_DEK,
        env.RUNTIME_MOCK,
        body,
      );
      return c.json(result, 202);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/sessions/{sessionId}/messages",
      tags: ["sessions"],
      request: { params: z.object({ sessionId: UuidParam }) },
      responses: {
        200: {
          content: {
            "application/json": { schema: PageSchema(SessionMessageSchema) },
          },
          description: "Messages",
        },
      },
    }),
    async (c) => {
      const { sessionId } = c.req.valid("param");
      const p = c.get("principal")!;
      const env = c.get("env");
      const { ctx, runtimeSessionRef } = await loadSessionRuntime(
        c.get("db"),
        sessionId,
        p.userId,
        p.isPlatformAdmin,
        env.PLATFORM_DEK,
        env.RUNTIME_MOCK,
      );
      const page = await opencodeAdapter.listMessages(ctx, runtimeSessionRef, {});
      return c.json(page, 200);
    },
  );

  // SSE — not via openapi JSON schema
  app.get("/sessions/:sessionId/events", async (c) => {
    const sessionId = c.req.param("sessionId");
    const p = c.get("principal")!;
    const env = c.get("env");
    const redis = c.get("redis");

    const { ctx, runtimeSessionRef, session } = await loadSessionRuntime(
      c.get("db"),
      sessionId,
      p.userId,
      p.isPlatformAdmin,
      env.PLATFORM_DEK,
      env.RUNTIME_MOCK,
    );

    const lastEventId = c.req.header("Last-Event-ID");
    let seq = lastEventId ? Number(lastEventId) : 0;
    if (Number.isNaN(seq)) seq = 0;

    const abort = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => abort.abort());

    const streamKey = `sess:${session.id}:events`;
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));
        const ping = setInterval(() => {
          try {
            write(": ping\n\n");
          } catch {
            /* closed */
          }
        }, 15_000);

        try {
          // Replay from Redis if Last-Event-ID (= Envelope.seq) present
          if (lastEventId) {
            const after = Number(lastEventId);
            const entries = await redis.xrange(streamKey, "-", "+");
            for (const [, fields] of entries) {
              const dataIdx = fields.indexOf("data");
              const seqIdx = fields.indexOf("seq");
              const payload = dataIdx >= 0 ? fields[dataIdx + 1] : null;
              const entrySeq = seqIdx >= 0 ? Number(fields[seqIdx + 1]) : NaN;
              if (!payload || Number.isNaN(entrySeq) || entrySeq <= after) continue;
              const parsed = JSON.parse(payload) as Envelope;
              seq = parsed.seq;
              write(`id: ${seq}\nevent: ${parsed.type}\ndata: ${payload}\n\n`);
            }
          }

          for await (const partial of opencodeAdapter.events(
            ctx,
            { sessionRef: runtimeSessionRef },
            abort.signal,
          )) {
            seq += 1;
            const envelope = makeEnvelope(
              session.id,
              seq,
              partial.type,
              partial.data as never,
              partial.raw,
            );
            const data = JSON.stringify(envelope);
            await redis.xadd(
              streamKey,
              "MAXLEN",
              "~",
              "2000",
              "*",
              "seq",
              String(seq),
              "data",
              data,
            );
            write(`id: ${seq}\nevent: ${envelope.type}\ndata: ${data}\n\n`);
          }
        } catch (err) {
          if (!abort.signal.aborted) {
            const envelope = makeEnvelope(session.id, ++seq, "error", {
              code: "UPSTREAM_UNAVAILABLE",
              message: err instanceof Error ? err.message : "SSE failed",
            });
            write(
              `id: ${seq}\nevent: error\ndata: ${JSON.stringify(envelope)}\n\n`,
            );
          }
        } finally {
          clearInterval(ping);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
      cancel() {
        abort.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });

  return app;
}
