import { and, eq } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import { credentialVersions, projectCredentials, runtimeInstances, tenants } from "@agenthub/db";
import { isWrappedDek, rewrapSecret, secretAad, type SecretKind } from "../lib/envelope.js";
import { recordAudit } from "../lib/audit.js";
import { activeKek } from "../lib/kek.js";
import { logger } from "../lib/logger.js";
import { ensureTenantDek } from "./tenant-dek.js";

function kindOf(value: string): SecretKind {
  if (value === "project" || value === "git" || value === "node") return value;
  return "user";
}

/**
 * Rewrap tenant DEKs, credential snapshots, and node auth secrets under the current KEK.
 * Plaintext is not logged. Remove an old KEK only after this job leaves no row on that version.
 */
export async function reencryptStoredSecrets(db: Db, platformDek: string, actorId = "system") {
  const kek = activeKek(platformDek);
  const versions: Record<string, number> = {};
  let credentials = 0;
  let nodes = 0;
  let tenantCount = 0;

  const tenantRows = await db.select().from(tenants);
  for (const tenant of tenantRows) {
    const blob = Buffer.from(tenant.dekCiphertext);
    if (!isWrappedDek(blob) || tenant.dekKeyVersion !== kek.currentVersion) {
      await ensureTenantDek(db, tenant.id, platformDek);
      tenantCount += 1;
    }
  }

  const projectRows = await db
    .select({ id: projectCredentials.id, tenantId: projectCredentials.tenantId })
    .from(projectCredentials);
  const tenantByCredential = new Map(projectRows.map((row) => [row.id, row.tenantId]));
  const rows = await db.select().from(credentialVersions);
  for (const row of rows) {
    const kind = kindOf(row.credentialKind);
    const tenantId = kind === "project" ? tenantByCredential.get(row.credentialId) ?? "project" : "user";
    const tenantDek =
      kind === "project" && tenantId !== "project"
        ? (await ensureTenantDek(db, tenantId, platformDek)).dek
        : undefined;
    const aad = secretAad({ tenantId, kind, id: row.credentialId, version: row.version });
    const next = await rewrapSecret(Buffer.from(row.secretCiphertext), {
      platformDek,
      kek,
      aad,
      ...(tenantDek ? { tenantDek } : {}),
    });
    await db
      .update(credentialVersions)
      .set({ secretCiphertext: next.blob, keyVersion: next.version })
      .where(
        and(
          eq(credentialVersions.credentialKind, row.credentialKind),
          eq(credentialVersions.credentialId, row.credentialId),
          eq(credentialVersions.version, row.version),
        ),
      );
    credentials += 1;
    versions[String(next.version)] = (versions[String(next.version)] ?? 0) + 1;
  }

  const instances = await db.select().from(runtimeInstances);
  for (const row of instances) {
    if (!row.authSecretCiphertext || !row.tenantId) continue;
    const aad = secretAad({ tenantId: row.tenantId, kind: "node", id: row.id, version: 1 });
    const next = await rewrapSecret(Buffer.from(row.authSecretCiphertext), { platformDek, kek, aad });
    await db
      .update(runtimeInstances)
      .set({ authSecretCiphertext: next.blob, authKeyVersion: next.version, updatedAt: new Date() })
      .where(eq(runtimeInstances.id, row.id));
    nodes += 1;
  }

  recordAudit({
    action: "credential.reencrypt",
    actorId,
    targetType: "kek",
    targetId: String(kek.currentVersion),
    meta: { credentials, nodes, tenants: tenantCount },
  });
  logger.info(
    { credentials, nodes, tenants: tenantCount, keyVersion: kek.currentVersion },
    "credential reencrypt finished",
  );
  return { credentials, nodes, tenants: tenantCount, keyVersion: kek.currentVersion, versions };
}
