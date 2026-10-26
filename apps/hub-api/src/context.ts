import type { Db } from "@agenthub/db";
import type { TenantRole } from "@agenthub/auth";
import type { Redis } from "ioredis";
import type { env as Env } from "./env.js";

export type Principal = {
  userId: string;
  email: string;
  displayName: string;
  handle: string;
  isPlatformAdmin: boolean;
  tenantId: string | null;
  tenantRoles: TenantRole[];
};

export type AppVariables = {
  requestId: string;
  db: Db;
  redis: Redis;
  env: typeof Env;
  principal: Principal | null;
};

export type AppEnv = {
  Variables: AppVariables;
};
