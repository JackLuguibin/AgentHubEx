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
    APPLY_ROOT: z.string().default("data/apply"),
    BLOB_ROOT: z.string().default("data/blobs"),
    PUBLIC_BASE_URL: z.string().default("http://localhost:8080"),
    SYNC_TOKEN_SECRET: z.string().min(16).default("dev-sync-token-secret!!"),
    SYNC_ED25519_PRIVATE_KEY: z.string().optional(),
    SYNC_ED25519_PUBLIC_KEY: z.string().optional(),
    PORT: z.coerce.number().int().default(8080),
    AGENTHUB_BOOTSTRAP_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
    AGENTHUB_BOOTSTRAP_ADMIN_PASSWORD: z.string().min(10).default("admin-password-change-me"),
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    /** When true (default), use in-process mock OpenCode if no real instance. */
    RUNTIME_MOCK: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    /**
     * Deployment profile (ADR-011). `intranet`/`airgap` forbid creating shared isolation
     * instances (ADR-013).
     */
    DEPLOY_PROFILE: z
      .enum(["intranet", "airgap", "internet-lab"])
      .default("intranet"),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
