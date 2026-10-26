import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z
      .string()
      .default("postgres://agenthub:agenthub@localhost:5432/agenthub"),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    JWT_ACCESS_SECRET: z.string().min(16).default("dev-access-secret-change-me"),
    JWT_REFRESH_SECRET: z.string().min(16).default("dev-refresh-secret-change-me"),
    PLATFORM_DEK: z
      .string()
      .min(32)
      .default("dev-platform-dek-32bytes-minimum!!"),
    PORT: z.coerce.number().int().default(8080),
    AGENTHUB_BOOTSTRAP_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
    AGENTHUB_BOOTSTRAP_ADMIN_PASSWORD: z.string().min(10).default("admin-password-change-me"),
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
