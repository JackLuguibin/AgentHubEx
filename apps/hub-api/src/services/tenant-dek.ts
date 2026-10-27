import { eq } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { tenants } from "@agenthub/db";
import { isWrappedDek, rewrapTenantDek, unwrapTenantDek, wrapNewTenantDek } from "../lib/envelope.js";
import { activeKek, type KekProvider } from "../lib/kek.js";

const cache = new Map<string, Buffer>();

function cacheKey(tenantId: string, version: number) {
  return `${tenantId}:${version}`;
}

export async function loadTenantDek(db: Db, tenantId: string, kek: KekProvider): Promise<Buffer | null> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return null;
  const blob = Buffer.from(tenant.dekCiphertext);
  if (!isWrappedDek(blob)) return null;
  const hit = cache.get(cacheKey(tenantId, tenant.dekKeyVersion));
  if (hit) return hit;
  const dek = await unwrapTenantDek(blob, kek);
  cache.set(cacheKey(tenantId, tenant.dekKeyVersion), dek);
  return dek;
}

/** Make sure the tenant DEK is a real 32-byte key wrapped by the current KEK. */
export async function ensureTenantDek(
  db: Db,
  tenantId: string,
  platformDek: string,
): Promise<{ dek: Buffer; version: number }> {
  const kek = activeKek(platformDek);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error("tenant missing");
  const blob = Buffer.from(tenant.dekCiphertext);
  if (isWrappedDek(blob)) {
    if (tenant.dekKeyVersion === kek.currentVersion) {
      const dek = (await loadTenantDek(db, tenantId, kek)) ?? (await unwrapTenantDek(blob, kek));
      return { dek, version: tenant.dekKeyVersion };
    }
    const rotated = await rewrapTenantDek(blob, kek);
    await db
      .update(tenants)
      .set({ dekCiphertext: rotated.blob, dekKeyVersion: rotated.version, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
    cache.set(cacheKey(tenantId, rotated.version), rotated.dek);
    return { dek: rotated.dek, version: rotated.version };
  }
  const created = await wrapNewTenantDek(kek);
  await db
    .update(tenants)
    .set({ dekCiphertext: created.blob, dekKeyVersion: created.version, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
  cache.set(cacheKey(tenantId, created.version), created.dek);
  return { dek: created.dek, version: created.version };
}
