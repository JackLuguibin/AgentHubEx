import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Key-encryption key. Phase 4 uses an intranet KMS when KMS_URL is set,
 * otherwise a local key ring (AGENTHUB_MASTER_KEY / _V{n}). The raw key
 * never leaves the provider: exportKey() always throws.
 */
export type WrappedDek = { blob: Buffer; version: number };

export type KekProvider = {
  readonly currentVersion: number;
  wrap(dek: Buffer): Promise<WrappedDek>;
  unwrap(blob: Buffer, version: number): Promise<Buffer>;
  exportKey(): never;
};

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function aesWrap(key: Buffer, dek: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function aesUnwrap(key: Buffer, blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const data = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

class LocalKek implements KekProvider {
  readonly currentVersion: number;
  #keys: Map<number, Buffer>;

  constructor(keys: Map<number, Buffer>, currentVersion: number) {
    this.#keys = keys;
    this.currentVersion = currentVersion;
  }

  async wrap(dek: Buffer): Promise<WrappedDek> {
    const key = this.#keys.get(this.currentVersion);
    if (!key) throw new Error("current KEK is not configured");
    return { blob: aesWrap(key, dek), version: this.currentVersion };
  }

  async unwrap(blob: Buffer, version: number): Promise<Buffer> {
    const ordered = [version, ...[...this.#keys.keys()].filter((item) => item !== version)];
    let last: unknown;
    for (const candidate of ordered) {
      const key = this.#keys.get(candidate);
      if (!key) continue;
      try {
        return aesUnwrap(key, blob);
      } catch (err) {
        last = err;
      }
    }
    throw last instanceof Error ? last : new Error("KEK unwrap failed");
  }

  exportKey(): never {
    throw new Error("KEK export is forbidden");
  }
}

/** Local ring. Highest version is the one used for new wraps. */
export function localKekFromEnv(env: NodeJS.ProcessEnv, platformDek: string): KekProvider {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = /^AGENTHUB_MASTER_KEY_V(\d+)$/.exec(name);
    if (match && value) keys.set(Number(match[1]), sha256(value));
  }
  if (env.AGENTHUB_MASTER_KEY) {
    const explicit = Number(env.AGENTHUB_MASTER_KEY_VERSION);
    const version = Number.isFinite(explicit) && explicit > 0
      ? explicit
      : keys.size > 0
        ? Math.max(...keys.keys()) + 1
        : 1;
    keys.set(version, sha256(env.AGENTHUB_MASTER_KEY));
  }
  if (keys.size === 0) keys.set(1, sha256(`kek:${platformDek}`));
  return new LocalKek(keys, Math.max(...keys.keys()));
}

export function activeKek(platformDek: string): KekProvider {
  const url = process.env.KMS_URL;
  if (url) {
    return httpKek({
      url,
      token: process.env.KMS_TOKEN,
      version: Number(process.env.KMS_KEY_VERSION ?? 1),
    });
  }
  return localKekFromEnv(process.env, platformDek);
}

/** Intranet KMS. Wrap and unwrap only; the key stays on the KMS. */
export function httpKek(opts: { url: string; token?: string; version: number }): KekProvider {
  const version = Number.isFinite(opts.version) && opts.version > 0 ? opts.version : 1;
  const base = opts.url.replace(/\/$/, "");

  async function post(pathname: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${base}${pathname}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`KMS ${pathname} failed (${res.status})`);
    return (await res.json()) as Record<string, unknown>;
  }

  return {
    currentVersion: version,
    async wrap(dek: Buffer) {
      const body = await post("/v1/wrap", { plaintext: dek.toString("base64") });
      const ciphertext = body.ciphertext;
      const remoteVersion = Number(body.version ?? version);
      if (typeof ciphertext !== "string" || !ciphertext) throw new Error("KMS wrap returned no ciphertext");
      return { blob: Buffer.from(ciphertext, "base64"), version: remoteVersion };
    },
    async unwrap(blob: Buffer, blobVersion: number) {
      const body = await post("/v1/unwrap", {
        ciphertext: blob.toString("base64"),
        version: blobVersion,
      });
      const plaintext = body.plaintext;
      if (typeof plaintext !== "string" || !plaintext) throw new Error("KMS unwrap returned no plaintext");
      return Buffer.from(plaintext, "base64");
    },
    exportKey(): never {
      throw new Error("KEK export is forbidden");
    },
  };
}
