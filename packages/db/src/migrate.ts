import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://agenthub:agenthub@localhost:5432/agenthub";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, "..", "drizzle");

async function main() {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  console.log(`Migrating ${connectionString.replace(/:[^:@]+@/, ":***@")} ...`);
  await migrate(db, { migrationsFolder });
  await client.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
