import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import type { Db } from "@agenthub/db";
import {
  agentSessions,
  credentialVersions,
  projectCredentials,
  projects,
  userCredentials,
} from "@agenthub/db";
import { verifyLlmProxyToken } from "@agenthub/auth";
import type { AppEnv } from "../context.js";
import { AppError, unauthenticated } from "../errors.js";
import { openCredentialSecret } from "../lib/envelope.js";
import { activeKek } from "../lib/kek.js";
import { loadTenantDek } from "./tenant-dek.js";
import { logger } from "../lib/logger.js";
import {
  createUsageAccumulator,
  providerUpstreamUrl,
  upstreamAuthHeaders,
} from "../lib/llm-upstream.js";
import { allowedHostsOf, assertProviderHostAllowed } from "../lib/provider-hosts.js";
import { assertDailyTokenQuota, tokensPerDayOf } from "../lib/token-quota.js";
import { recordUsage } from "./usage.js";
import { assertTenantActive } from "./tenants.js";

export async function handleLlmProxy(c: Context<AppEnv>): Promise<Response> {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) throw unauthenticated("Proxy token required");
  const token = header.slice("Bearer ".length).trim();
  let claims;
  try {
    claims = await verifyLlmProxyToken(token, c.get("env").LLM_PROXY_SECRET);
  } catch (err) {
    if (err instanceof Error && err.name === "JWTExpired") {
      throw new AppError(401, "TOKEN_EXPIRED", "Proxy token expired");
    }
    throw unauthenticated("Invalid proxy token");
  }

  const matched = /^\/llm\/([^/]+)(\/.*)?$/.exec(c.req.path);
  if (!matched?.[1]) {
    throw new AppError(400, "VALIDATION_FAILED", "LLM proxy path must include a provider");
  }
  const pathProvider = matched[1];
  const rest = matched[2] && matched[2].length > 0 ? matched[2] : "/";

  const db = c.get("db");
  const [session] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, claims.sid))
    .limit(1);
  if (
    !session ||
    session.workspaceId !== claims.wid ||
    session.ownerUserId !== claims.sub ||
    session.tenantId !== claims.tid ||
    session.projectId !== claims.pid ||
    session.status === "archived"
  ) {
    throw unauthenticated("Invalid proxy token");
  }
  const bound = session;

  const tenant = await assertTenantActive(db, bound.tenantId);
  const [project] = await db.select().from(projects).where(eq(projects.id, bound.projectId)).limit(1);
  if (!project || project.archivedAt) {
    throw new AppError(409, "PROJECT_ARCHIVED", "Project is archived");
  }

  const loaded = await loadSnapshot(db, bound);
  if (loaded.provider !== pathProvider) {
    throw new AppError(400, "VALIDATION_FAILED", "Proxy provider does not match the session credential");
  }
  if (!loaded.baseUrl) {
    throw new AppError(409, "CREDENTIAL_REQUIRED", "Provider baseUrl is not configured");
  }
  assertProviderHostAllowed(loaded.baseUrl, allowedHostsOf(project.settings));
  await assertDailyTokenQuota(c.get("redis"), tenant.id, tokensPerDayOf(tenant.quota));

  let upstreamUrl: string;
  try {
    upstreamUrl = providerUpstreamUrl(loaded.baseUrl, rest);
  } catch {
    throw new AppError(400, "VALIDATION_FAILED", "Invalid LLM proxy path");
  }

  const raw = Buffer.from(await c.req.arrayBuffer());
  const requestModel = modelOf(raw);
  const platformDek = c.get("env").PLATFORM_DEK;
  const tenantDek = loaded.tenantId
    ? await loadTenantDek(c.get("db"), loaded.tenantId, activeKek(platformDek))
    : null;
  let secret: string | null = await openCredentialSecret(asBuffer(loaded.ciphertext), {
    platformDek,
    kind: loaded.kind === "project" ? "project" : "user",
    id: bound.credentialId,
    version: bound.credentialVersion,
    tenantId: loaded.tenantId,
    tenantDek,
  });
  const scratch = Buffer.from(secret, "utf8");
  const headers = upstreamAuthHeaders(loaded.provider, secret, c.req.raw.headers);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: raw,
      redirect: "manual",
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.name : "fetch" }, "llm proxy upstream failed");
    throw new AppError(502, "UPSTREAM_UNAVAILABLE", "Provider request failed");
  } finally {
    secret = null;
    scratch.fill(0);
    headers.delete("x-api-key");
    headers.delete("authorization");
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    throw new AppError(502, "UPSTREAM_UNAVAILABLE", "Provider redirect is not followed");
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json";
  const accumulator = createUsageAccumulator(requestModel);
  const reader = upstream.body?.getReader();
  const decoder = new TextDecoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!reader) {
        await finish();
        controller.close();
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        accumulator.push(decoder.decode());
        accumulator.finish();
        await finish();
        controller.close();
        return;
      }
      accumulator.push(decoder.decode(value, { stream: true }));
      controller.enqueue(value);
    },
    cancel() {
      void reader?.cancel();
    },
  });

  async function finish() {
    if (upstream.status < 200 || upstream.status >= 300) return;
    const usage = accumulator.usage;
    try {
      await recordUsage(db, c.get("redis"), {
        tenantId: bound.tenantId,
        projectId: bound.projectId,
        userId: bound.ownerUserId,
        sessionId: bound.id,
        credentialSource: bound.credentialSource as "user" | "project",
        credentialId: bound.credentialId,
        provider: loaded.provider,
        model: usage.model ?? "unknown",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        costMicros: usage.costMicros,
        source: "llm_proxy",
      });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.name : "usage" }, "llm proxy usage write failed");
    }
  }

  const out = new Headers();
  out.set("content-type", contentType);
  return new Response(stream, { status: upstream.status, headers: out });
}

async function loadSnapshot(
  db: Db,
  session: { credentialSource: string; credentialId: string; credentialVersion: number },
) {
  const kind = session.credentialSource === "project" ? "project" : "user";
  const [version] = await db
    .select()
    .from(credentialVersions)
    .where(
      and(
        eq(credentialVersions.credentialKind, kind),
        eq(credentialVersions.credentialId, session.credentialId),
        eq(credentialVersions.version, session.credentialVersion),
      ),
    )
    .limit(1);
  if (!version || version.revokedAt) {
    throw new AppError(409, "CREDENTIAL_ROTATED", "Credential version is no longer valid", {
      details: { credentialId: session.credentialId, version: session.credentialVersion },
    });
  }

  if (kind === "user") {
    const [cred] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.id, session.credentialId))
      .limit(1);
    if (!cred || cred.status !== "active") {
      throw new AppError(409, "CREDENTIAL_REQUIRED", "Credential is not active");
    }
    return {
      kind,
      provider: cred.provider,
      baseUrl: baseUrlOf(cred.metadata),
      ciphertext: version.secretCiphertext,
      tenantId: null as string | null,
    };
  }

  const [cred] = await db
    .select()
    .from(projectCredentials)
    .where(eq(projectCredentials.id, session.credentialId))
    .limit(1);
  if (!cred || cred.status !== "active") {
    throw new AppError(409, "CREDENTIAL_REQUIRED", "Credential is not active");
  }
  return {
    kind,
    provider: cred.provider,
    baseUrl: baseUrlOf(cred.metadata),
    ciphertext: version.secretCiphertext,
    tenantId: cred.tenantId,
  };
}

function baseUrlOf(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || !("baseUrl" in metadata)) return undefined;
  const value = (metadata as { baseUrl?: unknown }).baseUrl;
  return typeof value === "string" ? value : undefined;
}

function asBuffer(value: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function modelOf(raw: Buffer): string | undefined {
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as { model?: unknown };
    return typeof parsed.model === "string" ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}
