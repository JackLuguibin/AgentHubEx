export const COMMON_TREE_DIR = "project-common";
export const RESERVED_PREFIX = ".agenthub";

export const LIMITS = {
  maxSegment: 255,
  maxPath: 1024,
  maxDepth: 32,
  maxFileBytes: 32 * 1024 * 1024,
  maxZipEntries: 200,
  maxZipUncompressed: 64 * 1024 * 1024,
  maxVersions: 20,
} as const;

export type CommonFsCode =
  | "INVALID_PATH"
  | "PROTECTED_PATH"
  | "QUOTA_EXCEEDED"
  | "INVALID_MIME";

export class CommonFsError extends Error {
  readonly code: CommonFsCode;

  constructor(code: CommonFsCode, message: string) {
    super(message);
    this.name = "CommonFsError";
    this.code = code;
  }
}

function hasControlChar(path: string) {
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** NFC, `/` separators, no `..`, no absolute path, no reserved `.agenthub` prefix. */
export function canonicalizePath(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new CommonFsError("INVALID_PATH", "路径不能为空");
  }
  if (raw.includes("\0")) {
    throw new CommonFsError("INVALID_PATH", "路径含有非法字符");
  }
  let path = raw.normalize("NFC").replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(path) || path.startsWith("/")) {
    throw new CommonFsError("INVALID_PATH", "路径必须是相对路径");
  }
  if (path.startsWith("./")) path = path.slice(2);
  if (path.endsWith("/")) path = path.slice(0, -1);
  if (hasControlChar(path)) {
    throw new CommonFsError("INVALID_PATH", "路径含有控制字符");
  }
  const parts = path.split("/");
  if (parts.length === 0 || parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new CommonFsError("INVALID_PATH", "路径不能包含 .. 或空段");
  }
  if (parts.length > LIMITS.maxDepth) {
    throw new CommonFsError("INVALID_PATH", "路径层级过深");
  }
  if (parts.some((part) => part.length > LIMITS.maxSegment)) {
    throw new CommonFsError("INVALID_PATH", "路径段过长");
  }
  if (parts[0] === RESERVED_PREFIX) {
    throw new CommonFsError("INVALID_PATH", "不能使用保留前缀 .agenthub");
  }
  const canonical = parts.join("/");
  if (canonical.length > LIMITS.maxPath) {
    throw new CommonFsError("INVALID_PATH", "路径过长");
  }
  return canonical;
}

export function isProtectedPath(path: string, prefixes: readonly string[]): boolean {
  const canonical = canonicalizePath(path);
  return prefixes.some((raw) => {
    const prefix = canonicalizePath(raw);
    return canonical === prefix || canonical.startsWith(`${prefix}/`);
  });
}

export function assertWritable(
  path: string,
  prefixes: readonly string[],
  allowProtected: boolean,
): string {
  const canonical = canonicalizePath(path);
  if (!allowProtected && isProtectedPath(canonical, prefixes)) {
    throw new CommonFsError("PROTECTED_PATH", "受保护前缀仅 owner 可修改");
  }
  return canonical;
}

export function joinPrefix(prefix: string, name: string): string {
  const fileName = name.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "";
  if (!prefix) return canonicalizePath(fileName);
  return canonicalizePath(`${canonicalizePath(prefix)}/${fileName}`);
}
