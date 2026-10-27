/** True when Last-Event-ID is absent from the Redis stream (overflow or never written). */
export function cursorMissing(lastEventId: string, seqs: number[]): boolean {
  const after = Number(lastEventId);
  if (!Number.isFinite(after)) return true;
  return !seqs.includes(after);
}

export function streamSeqs(entries: Array<[string, string[]]>): number[] {
  const seqs: number[] = [];
  for (const [, fields] of entries) {
    const idx = fields.indexOf("seq");
    if (idx < 0) continue;
    const n = Number(fields[idx + 1]);
    if (!Number.isNaN(n)) seqs.push(n);
  }
  return seqs;
}
