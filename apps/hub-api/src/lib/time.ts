export function toIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString();
}

export function etagFromUpdatedAt(d: Date): string {
  return `"${d.toISOString()}"`;
}
