import { createHmac, createPrivateKey, generateKeyPairSync, sign, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "@agenthub/config-bundle";

type KeyPair = { publicKey: string; privateKey: string };

function ephemeralKeys(): KeyPair {
  const g = globalThis as typeof globalThis & { __agenthubSyncKeys?: KeyPair };
  if (!g.__agenthubSyncKeys) {
    const pair = generateKeyPairSync("ed25519");
    g.__agenthubSyncKeys = {
      privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    };
  }
  return g.__agenthubSyncKeys;
}

function pem(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value.replace(/\\n/g, "\n");
}

export function syncPublicKey(publicKey?: string): string {
  return pem(publicKey, ephemeralKeys().publicKey);
}

export function signSyncPayload(payload: unknown, privateKey?: string): string {
  const key = createPrivateKey(pem(privateKey, ephemeralKeys().privateKey));
  return sign(null, Buffer.from(canonicalJson(payload)), key).toString("base64url");
}

export function issueSyncToken(instanceId: string, secret: string, ttlSec = 60 * 60 * 24 * 30): { token: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = Buffer.from(JSON.stringify({ instanceId, exp })).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return {
    token: `st1.${body}.${mac}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function readSyncToken(token: string, secret: string): { instanceId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "st1" || !parts[1] || !parts[2]) return null;
  const expected = createHmac("sha256", secret).update(parts[1]).digest("base64url");
  const actual = Buffer.from(parts[2]);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      instanceId?: string;
      exp?: number;
    };
    if (!payload.instanceId || !payload.exp || payload.exp < Date.now() / 1000) return null;
    return { instanceId: payload.instanceId };
  } catch {
    return null;
  }
}

export function signPayloadQuery(jobId: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${jobId}.${exp}`).digest("base64url");
}

export function payloadQueryMatches(jobId: string, exp: number, sig: string, secret: string): boolean {
  const expected = signPayloadQuery(jobId, exp, secret);
  const actual = Buffer.from(sig);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) return false;
  return timingSafeEqual(actual, wanted);
}
