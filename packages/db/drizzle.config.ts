import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./src/schema/identity.ts",
    "./src/schema/credentials.ts",
    "./src/schema/nodes.ts",
    "./src/schema/runtime.ts",
    "./src/schema/workspaces.ts",
    "./src/schema/issues.ts",
    "./src/schema/api-keys.ts",
    "./src/schema/config.ts",
  ],

  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://agenthub:agenthub@localhost:5432/agenthub",
  },
  strict: true,
  verbose: true,
});
