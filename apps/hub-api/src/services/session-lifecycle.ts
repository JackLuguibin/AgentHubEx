import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { agentSessions } from "@agenthub/db";

const LIVE_STATUSES = ["creating", "active", "busy", "idle"];

/** Mark live sessions aborted. Does not call the runtime; the gate is the Hub row. */
export async function abortLiveSessions(
  db: Db,
  scope: { tenantId?: string; projectId?: string; ownerUserId?: string },
  reason: string,
) {
  if (!scope.tenantId && !scope.projectId) {
    throw new Error("abortLiveSessions requires tenantId or projectId");
  }
  await db
    .update(agentSessions)
    .set({ status: "aborted", statusReason: reason, updatedAt: new Date() })
    .where(
      and(
        inArray(agentSessions.status, LIVE_STATUSES),
        scope.tenantId ? eq(agentSessions.tenantId, scope.tenantId) : undefined,
        scope.projectId ? eq(agentSessions.projectId, scope.projectId) : undefined,
        scope.ownerUserId ? eq(agentSessions.ownerUserId, scope.ownerUserId) : undefined,
      ),
    );
}
