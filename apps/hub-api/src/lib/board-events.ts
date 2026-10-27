import type { Redis } from "ioredis";

export type BoardEventName = "issue.upserted" | "issue.deleted" | "board.resync";

export function boardChannel(projectId: string) {
  return `board:${projectId}`;
}

export async function publishBoard(
  redis: Redis,
  projectId: string,
  event: BoardEventName,
  data: unknown,
) {
  try {
    await redis.publish(boardChannel(projectId), JSON.stringify({ event, data }));
  } catch {
    // Realtime is best-effort. Clients fall back to polling the board.
  }
}
