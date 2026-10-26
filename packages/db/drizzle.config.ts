import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/identity.ts",

  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://agenthub:agenthub@localhost:5432/agenthub",
  },
  strict: true,
  verbose: true,
});
