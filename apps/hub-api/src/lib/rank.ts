const LOW = 33;
const HIGH = 126;

/** Lexicographic rank strictly between two neighbors. Null means the end of the column. */
export function rankBetween(before: string | null, after: string | null): string {
  if (!before && !after) return "n";
  if (before && !after) return `${before}n`;
  if (!before && after) return stringBefore(after);
  if (before! >= after!) return `${before}n`;
  return stringBetween(before!, after!);
}

function stringBefore(value: string): string {
  const code = value.charCodeAt(0);
  if (code > LOW + 1) {
    return String.fromCharCode(Math.floor((LOW + code) / 2));
  }
  return String.fromCharCode(LOW);
}

function stringBetween(a: string, b: string): string {
  let prefix = "";
  const limit = Math.max(a.length, b.length);
  for (let i = 0; i < limit; i++) {
    const ac = i < a.length ? a.charCodeAt(i) : LOW;
    const bc = i < b.length ? b.charCodeAt(i) : HIGH;
    if (ac === bc) {
      prefix += String.fromCharCode(ac);
      continue;
    }
    if (bc - ac > 1) {
      return prefix + String.fromCharCode(Math.floor((ac + bc) / 2));
    }
    prefix += String.fromCharCode(ac);
    const extended = `${prefix}n`;
    if (extended > a && extended < b) return extended;
  }
  const extended = `${a}n`;
  if (extended < b) return extended;
  return `${a}n`;
}
