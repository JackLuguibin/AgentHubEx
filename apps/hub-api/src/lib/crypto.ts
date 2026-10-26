import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function dekKey(platformDek: string): Buffer {
  return createHash("sha256").update(platformDek).digest();
}

/** AES-256-GCM; returns iv(12) || tag(16) || ciphertext */
export function encryptSecret(plaintext: string, platformDek: string): Buffer {
  const key = dekKey(platformDek);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptSecret(blob: Buffer, platformDek: string): string {
  const key = dekKey(platformDek);
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const data = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function last4OfSecret(secret: string): string {
  return secret.slice(-4);
}

/** Placeholder tenant DEK (wrapped) for P0 — real KMS wrapping is later. */
export function placeholderTenantDek(platformDek: string): Buffer {
  return encryptSecret(`tenant-dek:${randomBytes(16).toString("hex")}`, platformDek);
}
