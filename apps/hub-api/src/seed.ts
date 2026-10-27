import {
  createDb,
  tenantMemberships,
  tenants,
  users,
  projects,
  projectMemberships,
  userCredentials,
  credentialVersions,
} from "@agenthub/db";
import { and, eq } from "drizzle-orm";
import { env } from "./env.js";
import { last4OfSecret } from "./lib/crypto.js";
import { sealUserSecret, wrapNewTenantDek } from "./lib/envelope.js";
import { activeKek } from "./lib/kek.js";
import { newId } from "./lib/id.js";
import { ensurePasswordHash } from "./services/auth.js";
import { findUserByEmail } from "./services/users.js";
import { logger } from "./lib/logger.js";

async function main() {
  const db = createDb(env.DATABASE_URL);
  const adminEmail = env.AGENTHUB_BOOTSTRAP_ADMIN_EMAIL;
  const adminPassword = env.AGENTHUB_BOOTSTRAP_ADMIN_PASSWORD;

  let admin = await findUserByEmail(db, adminEmail);
  if (!admin) {
    const id = newId();
    const [row] = await db
      .insert(users)
      .values({
        id,
        email: adminEmail,
        displayName: "Platform Admin",
        handle: "admin",
        passwordHash: await ensurePasswordHash(adminPassword),
        isPlatformAdmin: true,
      })
      .returning();
    admin = row!;
    logger.info({ email: adminEmail }, "created platform admin");
  } else {
    // Local/dev: keep bootstrap password in sync so demo login stays usable after tests wipe/recreate DB.
    await db
      .update(users)
      .set({
        isPlatformAdmin: true,
        passwordHash: await ensurePasswordHash(adminPassword),
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(users.id, admin.id));
    const [fresh] = await db.select().from(users).where(eq(users.id, admin.id)).limit(1);
    admin = fresh!;
    logger.info({ email: adminEmail }, "synced platform admin password / privileges");
  }

  const demoSlug = "acme";
  let [tenant] = await db.select().from(tenants).where(eq(tenants.slug, demoSlug)).limit(1);
  if (!tenant) {
    const tenantId = newId();
    const wrappedDek = await wrapNewTenantDek(activeKek(env.PLATFORM_DEK));
    wrappedDek.dek.fill(0);
    const [row] = await db
      .insert(tenants)
      .values({
        id: tenantId,
        slug: demoSlug,
        name: "Acme Corp",
        status: "active",
        quota: { maxConcurrentSessionsPerUser: 5, maxActiveWorkspaces: 50 },
        settings: { allowedLoginMethods: ["password"] },
        dekCiphertext: wrappedDek.blob,
        dekKeyVersion: wrappedDek.version,
      })
      .returning();
    tenant = row!;

    await db.insert(tenantMemberships).values({
      tenantId: tenant.id,
      userId: admin.id,
      role: "owner",
    });
    logger.info({ slug: demoSlug }, "created demo tenant");
  }

  const [existingProject] = await db
    .select()
    .from(projects)
    .where(eq(projects.tenantId, tenant.id))
    .limit(1);

  if (!existingProject) {
    const projectId = newId();
    await db.insert(projects).values({
      id: projectId,
      tenantId: tenant.id,
      key: "DEMO",
      name: "Demo Project",
      description: "Seeded project for local development",
    });
    await db.insert(projectMemberships).values({
      tenantId: tenant.id,
      projectId,
      userId: admin.id,
      role: "owner",
    });
    logger.info({ key: "DEMO" }, "created demo project");
  }

  // optional member user (password synced so `pnpm seed` recovers after tests wipe/recreate users)
  const memberEmail = "member@example.com";
  const memberPassword = "member-password-change-me";
  let member = await findUserByEmail(db, memberEmail);
  if (!member) {
    const id = newId();
    const [row] = await db
      .insert(users)
      .values({
        id,
        email: memberEmail,
        displayName: "Demo Member",
        handle: "member",
        passwordHash: await ensurePasswordHash(memberPassword),
      })
      .returning();
    member = row!;
    logger.info({ email: memberEmail }, "created demo member user");
  } else {
    await db
      .update(users)
      .set({
        passwordHash: await ensurePasswordHash(memberPassword),
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(users.id, member.id));
    const [fresh] = await db.select().from(users).where(eq(users.id, member.id)).limit(1);
    member = fresh!;
    logger.info({ email: memberEmail }, "synced demo member password");
  }

  const [tm] = await db
    .select()
    .from(tenantMemberships)
    .where(eq(tenantMemberships.userId, member.id))
    .limit(1);
  if (!tm) {
    await db.insert(tenantMemberships).values({
      tenantId: tenant.id,
      userId: member.id,
      role: "member",
    });
  }

  const [proj] = await db
    .select()
    .from(projects)
    .where(eq(projects.tenantId, tenant.id))
    .limit(1);
  if (proj) {
    const [pm] = await db
      .select()
      .from(projectMemberships)
      .where(eq(projectMemberships.userId, member.id))
      .limit(1);
    if (!pm) {
      await db.insert(projectMemberships).values({
        tenantId: tenant.id,
        projectId: proj.id,
        userId: member.id,
        role: "developer",
      });
    }
  }

  // Dev credential for session Facade (secret never returned by API)
  const [existingCred] = await db
    .select()
    .from(userCredentials)
    .where(
      and(eq(userCredentials.userId, admin.id), eq(userCredentials.label, "dev-mock")),
    )
    .limit(1);
  if (!existingCred) {
    const credId = newId();
    const secret = "sk-mock-local-only";
    const sealed = await sealUserSecret(secret, credId, 1, env.PLATFORM_DEK);
    await db.insert(userCredentials).values({
      id: credId,
      userId: admin.id,
      provider: "opencode",
      label: "dev-mock",
      metadata: { defaultModel: "mock" },
      last4: last4OfSecret(secret),
      status: "active",
      currentVersion: 1,
    });
    await db.insert(credentialVersions).values({
      credentialKind: "user",
      credentialId: credId,
      version: 1,
      secretCiphertext: sealed.blob,
      keyVersion: sealed.keyVersion,
      createdBy: admin.id,
    });
    logger.info("created admin dev-mock credential");
  }

  logger.info("seed complete");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "seed failed");
  process.exit(1);
});
