import { OpenAPIHono } from "@hono/zod-openapi";
import { CreateIssueReqSchema, IssuePrioritySchema, IssueStatusSchema, UpdateIssueReqSchema } from "@agenthub/domain";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { boardChannel, publishBoard } from "../lib/board-events.js";
import { requireAuth } from "../middleware/auth.js";
import {
  createIssue,
  deleteIssue,
  getBoard,
  getIssue,
  listIssues,
  updateIssue,
  type IssueListQuery,
} from "../services/issues.js";

const ListQuerySchema = z.object({
  status: IssueStatusSchema.optional(),
  assignee: z.string().optional(),
  label: z.string().optional(),
  priority: IssuePrioritySchema.optional(),
  q: z.string().optional(),
  includeCancelled: z.enum(["true", "false"]).optional(),
});

function parseListQuery(raw: Record<string, string>): IssueListQuery {
  const parsed = ListQuerySchema.parse({
    status: raw.status || undefined,
    assignee: raw.assignee || undefined,
    label: raw.label || undefined,
    priority: raw.priority || undefined,
    q: raw.q || undefined,
    includeCancelled: raw.includeCancelled || undefined,
  });
  if (
    parsed.assignee &&
    parsed.assignee !== "me" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.assignee)
  ) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["assignee"],
        message: "assignee must be me or a user id",
      },
    ]);
  }
  return {
    status: parsed.status,
    assignee: parsed.assignee,
    label: parsed.label,
    priority: parsed.priority,
    q: parsed.q,
    includeCancelled: parsed.includeCancelled === "true",
  };
}

export function issueRoutes() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/projects/:p/board", async (c) => {
    const principal = c.get("principal")!;
    return c.json(
      await getBoard(
        c.get("db"),
        c.req.param("p"),
        principal.userId,
        principal.isPlatformAdmin,
        parseListQuery(c.req.query()),
      ),
    );
  });

  app.get("/projects/:p/board/events", async (c) => {
    const principal = c.get("principal")!;
    const projectId = c.req.param("p");
    await getBoard(c.get("db"), projectId, principal.userId, principal.isPlatformAdmin);
    const redis = c.get("redis").duplicate();
    const channel = boardChannel(projectId);
    let closed = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      if (ping) clearInterval(ping);
      void redis.unsubscribe(channel).finally(() => redis.quit());
    };
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const write = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            close();
          }
        };
        const onMessage = (_channel: string, message: string) => {
          try {
            const parsed = JSON.parse(message) as { event?: string; data?: unknown };
            if (!parsed.event) return;
            write(`event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data ?? null)}\n\n`);
          } catch {
            /* ignore malformed pubsub payloads */
          }
        };
        await redis.subscribe(channel);
        redis.on("message", onMessage);
        write(`event: board.resync\ndata: ${JSON.stringify({ reason: "subscribe" })}\n\n`);
        ping = setInterval(() => write(`: ping\n\n`), 15_000);
        c.req.raw.signal.addEventListener("abort", () => {
          close();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      },
      cancel() {
        close();
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

  app.get("/projects/:p/issues", async (c) => {
    const principal = c.get("principal")!;
    return c.json(
      await listIssues(
        c.get("db"),
        c.req.param("p"),
        principal.userId,
        principal.isPlatformAdmin,
        parseListQuery(c.req.query()),
      ),
    );
  });

  app.post("/projects/:p/issues", async (c) => {
    const principal = c.get("principal")!;
    const projectId = c.req.param("p");
    const body = CreateIssueReqSchema.parse(await c.req.json());
    const created = await createIssue(
      c.get("db"),
      projectId,
      principal.userId,
      principal.isPlatformAdmin,
      body,
    );
    await publishBoard(c.get("redis"), projectId, "issue.upserted", created);
    return c.json(created, 201);
  });

  app.get("/issues/:idOrKey", async (c) => {
    const principal = c.get("principal")!;
    return c.json(
      await getIssue(
        c.get("db"),
        c.req.param("idOrKey"),
        principal.userId,
        principal.isPlatformAdmin,
      ),
    );
  });

  app.patch("/issues/:idOrKey", async (c) => {
    const principal = c.get("principal")!;
    const body = UpdateIssueReqSchema.parse(await c.req.json());
    const updated = await updateIssue(
      c.get("db"),
      c.req.param("idOrKey"),
      principal.userId,
      principal.isPlatformAdmin,
      body,
      c.req.header("if-match"),
    );
    await publishBoard(c.get("redis"), updated.projectId, "issue.upserted", updated);
    return c.json(updated);
  });

  app.delete("/issues/:idOrKey", async (c) => {
    const principal = c.get("principal")!;
    const removed = await deleteIssue(
      c.get("db"),
      c.req.param("idOrKey"),
      principal.userId,
      principal.isPlatformAdmin,
    );
    await publishBoard(c.get("redis"), removed.projectId, "issue.deleted", { id: removed.id });
    return c.body(null, 204);
  });

  return app;
}
