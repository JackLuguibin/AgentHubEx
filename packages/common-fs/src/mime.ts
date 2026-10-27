import { CommonFsError } from "./path.js";

const DENIED_EXT = new Set([
  "exe",
  "dll",
  "so",
  "dylib",
  "bat",
  "cmd",
  "com",
  "msi",
  "scr",
]);

const DENIED_MIME = new Set([
  "application/x-msdownload",
  "application/x-executable",
  "application/x-dosexec",
  "application/x-sharedlib",
  "application/x-mach-binary",
  "application/x-msdos-program",
]);

const BY_EXT: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  yaml: "text/yaml",
  yml: "text/yaml",
  xml: "application/xml",
  csv: "text/csv",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  ts: "text/plain",
  tsx: "text/plain",
  jsx: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  zip: "application/zip",
};

export function normalizeMime(path: string, declared?: string | null): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext && DENIED_EXT.has(ext)) {
    throw new CommonFsError("INVALID_MIME", "不允许上传可执行文件");
  }
  const raw = (declared ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const guessed = BY_EXT[ext] ?? (raw || "application/octet-stream");
  const mime = raw && raw !== "application/octet-stream" ? raw : guessed;
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) {
    throw new CommonFsError("INVALID_MIME", "MIME 类型无效");
  }
  if (DENIED_MIME.has(mime)) {
    throw new CommonFsError("INVALID_MIME", "不允许上传可执行文件");
  }
  return mime;
}

export function assertQuota(used: number, delta: number, quota: number) {
  if (used + delta > quota) {
    throw new CommonFsError("QUOTA_EXCEEDED", "公共空间配额不足");
  }
}
