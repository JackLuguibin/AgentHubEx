import type { Redis } from "ioredis";
import { AppError } from "../errors.js";

/** UTC day key. Architecture 04 §4.8.1: `usage:tok:{tenantId}:{yyyyMMdd}`. */
export function usageDayKey(tenantId: string, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `usage:tok:${tenantId}:${y}${m}${d}`;
}

export function tokensPerDayOf(quota: unknown): number | undefined {
  if (!quota || typeof quota !== "object") return undefined;
  const value = (quota as { tokensPerDay?: unknown }).tokensPerDay;
  return typeof value === "number" ? value : undefined;
}

export function isDailyTokenQuotaExceeded(used: number, tokensPerDay: number | undefined): boolean {
  if (tokensPerDay == null) return false;
  return used >= tokensPerDay;
}

export async function assertDailyTokenQuota(
  redis: Redis,
  tenantId: string,
  tokensPerDay: number | undefined,
) {
  if (tokensPerDay == null) return;
  const raw = await redis.get(usageDayKey(tenantId));
  const used = raw ? Number(raw) : 0;
  if (!isDailyTokenQuotaExceeded(used, tokensPerDay)) return;
  throw new AppError(429, "QUOTA_EXCEEDED", "Daily token quota exceeded", {
    details: { quota: "tokensPerDay", limit: tokensPerDay, used },
  });
}

export async function addDailyTokenUsage(redis: Redis, tenantId: string, tokens: number) {
  if (tokens <= 0) return;
  const key = usageDayKey(tenantId);
  await redis.incrby(key, tokens);
  await redis.expire(key, 60 * 60 * 48);
}
