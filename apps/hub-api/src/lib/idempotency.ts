import type { Redis } from "ioredis";
import { conflict } from "../errors.js";

export async function withIdempotency(
  redis: Redis,
  key: string,
  produce: () => Promise<{ status: number; body: unknown }>,
): Promise<{ status: number; body: unknown }> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as { status: number; body: unknown };

  const lockKey = `${key}:lock`;
  const locked = await redis.set(lockKey, "1", "EX", 30, "NX");
  if (!locked) {
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const again = await redis.get(key);
      if (again) return JSON.parse(again) as { status: number; body: unknown };
    }
    throw conflict("Idempotency key is still in progress");
  }

  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as { status: number; body: unknown };
    const result = await produce();
    await redis.set(key, JSON.stringify(result), "EX", 60 * 60 * 24);
    return result;
  } finally {
    await redis.del(lockKey);
  }
}
