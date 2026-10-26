import { createDb, tenantMemberships, tenants, users, projects, projectMemberships } from "@agenthub/db";
import { eq } from "drizzle-orm";
import { env } from "./env.js";
import { placeholderTenantDek } from "./lib/crypto.js";
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
  } else if (!admin.isPlatformAdmin) {
    await db
      .update(users)
      .set({ isPlatformAdmin: true, updatedAt: new Date() })
      .where(eq(users.id, admin.id));
    logger.info({ email: adminEmail }, "promoted user to platform admin");
  } else {
    logger.info({ email: adminEmail }, "platform admin already exists");
  }

  const demoSlug = "acme";
  let [tenant] = await db.select().from(tenants).where(eq(tenants.slug, demoSlug)).limit(1);
  if (!tenant) {
    const tenantId = newId();
    const [row] = await db
      .insert(tenants)
      .values({
        id: tenantId,
        slug: demoSlug,
        name: "Acme Corp",
        status: "active",
        quota: { maxConcurrentSessionsPerUser: 5, maxActiveWorkspaces: 50 },
        settings: { allowedLoginMethods: ["password"] },
        dekCiphertext: placeholderTenantDek(env.PLATFORM_DEK),
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

  // optional member user
  const memberEmail = "member@example.com";
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
        passwordHash: await ensurePasswordHash("member-password-change-me"),
      })
      .returning();
    member = row!;
    logger.info({ email: memberEmail }, "created demo member user");
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

  logger.info("seed complete");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "seed failed");
  process.exit(1);
});
