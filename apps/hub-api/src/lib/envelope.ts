import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { decryptSecret } from "./crypto.js";
import { activeKek, type KekProvider } from "./kek.js";

const SECRET_MAGIC = "AH1";
const DEK_MAGIC = "AHW";
const FLAG_TENANT = 0x01;
const FLAG_WRAPPED = 0x02;

export type SecretKind = "user" | "project" | "git" | "node";

/** aad = tenantId|kind|id|version. Stops a ciphertext from being replayed onto another row. */
export function secretAad(parts: { tenantId: string; kind: SecretKind; id: string; version: number }): string {
  return `${parts.tenantId}|${parts.kind}|${parts.id}|${parts.version}`;
}

function aes(key: Buffer, plain: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function unaes(key: Buffer, blob: Buffer, aad: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const data = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  decipher.setAAD(aad);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function isEnvelope(blob: Buffer): boolean {
  return blob.length > 6 && blob.subarray(0, 3).toString("utf8") === SECRET_MAGIC;
}

export function isWrappedDek(blob: Buffer): boolean {
  return blob.length > 7 && blob.subarray(0, 3).toString("utf8") === DEK_MAGIC;
}

function dekHeader(version: number, wrapped: Buffer): Buffer {
  const header = Buffer.alloc(7);
  header.write(DEK_MAGIC, 0, "utf8");
  header.writeUInt16BE(version, 3);
  header.writeUInt16BE(wrapped.length, 5);
  return Buffer.concat([header, wrapped]);
}

export async function wrapNewTenantDek(kek: KekProvider): Promise<{ blob: Buffer; version: number; dek: Buffer }> {
  const dek = randomBytes(32);
  const wrapped = await kek.wrap(dek);
  return { blob: dekHeader(wrapped.version, wrapped.blob), version: wrapped.version, dek };
}

export async function rewrapTenantDek(blob: Buffer, kek: KekProvider): Promise<{ blob: Buffer; version: number; dek: Buffer }> {
  const dek = await unwrapTenantDek(blob, kek);
  const wrapped = await kek.wrap(dek);
  return { blob: dekHeader(wrapped.version, wrapped.blob), version: wrapped.version, dek };
}

export async function unwrapTenantDek(blob: Buffer, kek: KekProvider): Promise<Buffer> {
  if (!isWrappedDek(blob)) throw new Error("tenant DEK is not wrapped");
  const version = blob.readUInt16BE(3);
  const len = blob.readUInt16BE(5);
  const wrapped = blob.subarray(7, 7 + len);
  const dek = await kek.unwrap(wrapped, version);
  if (dek.length !== 32) throw new Error("tenant DEK has an unexpected length");
  return dek;
}

/** Per-secret DEK wrapped by the KEK. Used for user credentials and node auth secrets. */
export async function sealWrapped(
  plaintext: string,
  aad: string,
  kek: KekProvider,
): Promise<{ blob: Buffer; version: number }> {
  const dek = randomBytes(32);
  try {
    const wrapped = await kek.wrap(dek);
    const body = aes(dek, Buffer.from(plaintext, "utf8"), Buffer.from(aad, "utf8"));
    const header = Buffer.alloc(8);
    header.write(SECRET_MAGIC, 0, "utf8");
    header[3] = FLAG_WRAPPED;
    header.writeUInt16BE(wrapped.version, 4);
    header.writeUInt16BE(wrapped.blob.length, 6);
    return { blob: Buffer.concat([header, wrapped.blob, body]), version: wrapped.version };
  } finally {
    dek.fill(0);
  }
}

/** Secret encrypted with the tenant DEK. The KEK only wraps that DEK. */
export function sealWithTenantDek(plaintext: string, aad: string, dek: Buffer, version: number): Buffer {
  const body = aes(dek, Buffer.from(plaintext, "utf8"), Buffer.from(aad, "utf8"));
  const header = Buffer.alloc(6);
  header.write(SECRET_MAGIC, 0, "utf8");
  header[3] = FLAG_TENANT;
  header.writeUInt16BE(version, 4);
  return Buffer.concat([header, body]);
}

export async function openSecret(
  blob: Buffer,
  opts: { platformDek: string; kek: KekProvider; aad: string; tenantDek?: Buffer },
): Promise<string> {
  if (!isEnvelope(blob)) return decryptSecret(blob, opts.platformDek);
  const flag = blob[3];
  const aad = Buffer.from(opts.aad, "utf8");
  if (flag === FLAG_TENANT) {
    if (!opts.tenantDek) throw new Error("tenant DEK is required");
    return unaes(opts.tenantDek, blob.subarray(6), aad).toString("utf8");
  }
  if (flag !== FLAG_WRAPPED) throw new Error("unknown secret envelope");
  const version = blob.readUInt16BE(4);
  const len = blob.readUInt16BE(6);
  const wrapped = blob.subarray(8, 8 + len);
  const dek = await opts.kek.unwrap(wrapped, version);
  try {
    return unaes(dek, blob.subarray(8 + len), aad).toString("utf8");
  } finally {
    dek.fill(0);
  }
}

/** Rewrite the KEK wrap. Legacy rows are decrypted once and sealed under the current KEK. */
export async function rewrapSecret(
  blob: Buffer,
  opts: { platformDek: string; kek: KekProvider; aad: string; tenantDek?: Buffer },
): Promise<{ blob: Buffer; version: number }> {
  if (!isEnvelope(blob)) {
    const plain = decryptSecret(blob, opts.platformDek);
    if (opts.tenantDek) {
      return {
        blob: sealWithTenantDek(plain, opts.aad, opts.tenantDek, opts.kek.currentVersion),
        version: opts.kek.currentVersion,
      };
    }
    return sealWrapped(plain, opts.aad, opts.kek);
  }
  const flag = blob[3];
  if (flag === FLAG_TENANT) {
    if (!opts.tenantDek) throw new Error("tenant DEK is required");
    const plain = await openSecret(blob, opts);
    return {
      blob: sealWithTenantDek(plain, opts.aad, opts.tenantDek, opts.kek.currentVersion),
      version: opts.kek.currentVersion,
    };
  }
  const version = blob.readUInt16BE(4);
  const len = blob.readUInt16BE(6);
  const wrapped = blob.subarray(8, 8 + len);
  const body = blob.subarray(8 + len);
  const dek = await opts.kek.unwrap(wrapped, version);
  try {
    const next = await opts.kek.wrap(dek);
    const header = Buffer.alloc(8);
    header.write(SECRET_MAGIC, 0, "utf8");
    header[3] = FLAG_WRAPPED;
    header.writeUInt16BE(next.version, 4);
    header.writeUInt16BE(next.blob.length, 6);
    return { blob: Buffer.concat([header, next.blob, body]), version: next.version };
  } finally {
    dek.fill(0);
  }
}

export async function sealNodeSecret(password: string, tenantId: string, instanceId: string, platformDek: string) {
  const kek = activeKek(platformDek);
  const sealed = await sealWrapped(
    password,
    secretAad({ tenantId, kind: "node", id: instanceId, version: 1 }),
    kek,
  );
  return { blob: sealed.blob, keyVersion: sealed.version };
}

export async function openNodeSecret(
  blob: Buffer,
  tenantId: string,
  instanceId: string,
  platformDek: string,
): Promise<string> {
  return openSecret(blob, {
    platformDek,
    kek: activeKek(platformDek),
    aad: secretAad({ tenantId, kind: "node", id: instanceId, version: 1 }),
  });
}

export async function sealUserSecret(plaintext: string, credentialId: string, version: number, platformDek: string) {
  const kek = activeKek(platformDek);
  const sealed = await sealWrapped(
    plaintext,
    secretAad({ tenantId: "user", kind: "user", id: credentialId, version }),
    kek,
  );
  return { blob: sealed.blob, keyVersion: sealed.version };
}

export async function openCredentialSecret(
  blob: Buffer,
  input: {
    platformDek: string;
    kind: SecretKind;
    id: string;
    version: number;
    tenantId?: string | null;
    tenantDek?: Buffer | null;
  },
): Promise<string> {
  const tenantId = input.kind === "project" ? input.tenantId || "project" : input.kind === "node" ? input.tenantId || "platform" : "user";
  const version = input.kind === "node" ? 1 : input.version;
  return openSecret(blob, {
    platformDek: input.platformDek,
    kek: activeKek(input.platformDek),
    aad: secretAad({ tenantId, kind: input.kind, id: input.id, version }),
    ...(input.tenantDek ? { tenantDek: input.tenantDek } : {}),
  });
}
