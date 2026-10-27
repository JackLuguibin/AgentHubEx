import type { SecretRef } from "@agenthub/domain";

export function isSecretRef(value: unknown): value is SecretRef {
  if (!value || typeof value !== "object" || !("$secret" in value)) return false;
  const secret = (value as SecretRef).$secret;
  return (
    Boolean(secret) &&
    (secret.kind === "projectCredential" || secret.kind === "vault") &&
    typeof secret.id === "string"
  );
}

export function secretPlaceholder(ref: SecretRef): string {
  const { kind, id, field } = ref.$secret;
  return field ? `\${secret:${kind}:${id}:${field}}` : `\${secret:${kind}:${id}}`;
}

export function walkSecrets(
  value: unknown,
  resolve: (ref: SecretRef) => string,
): unknown {
  if (isSecretRef(value)) return resolve(value);
  if (Array.isArray(value)) return value.map((item) => walkSecrets(item, resolve));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walkSecrets(child, resolve);
    }
    return out;
  }
  return value;
}
