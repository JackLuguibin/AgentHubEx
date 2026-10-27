import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { MANAGED_MANIFEST_PATH } from "@agenthub/runtime-contract";
import { sha256Buffer } from "./hash.js";
import { normalizeManagedPath } from "./paths.js";

export type ManagedWrite = { path: string; content: Buffer };

export type ApplyFilesResult = {
  added: string[];
  removed: string[];
  changed: string[];
  manifest: Record<string, string>;
};

async function readManagedList(root: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(root, MANAGED_MANIFEST_PATH), "utf8");
    const parsed = JSON.parse(raw) as { files?: Record<string, string> };
    return parsed.files ?? {};
  } catch {
    return {};
  }
}

async function assertNoSymlinkEscape(root: string, relPath: string) {
  const parts = relPath.split("/");
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`symlink not allowed: ${relPath}`);
      }
      if (i < parts.length - 1 && !stat.isDirectory()) {
        throw new Error(`not a directory: ${relPath}`);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw err;
    }
  }
  const rel = relative(root, dirname(join(root, relPath)));
  if (rel.startsWith("..") || rel.split(sep).includes("..")) {
    throw new Error(`path escapes workspace: ${relPath}`);
  }
}

async function writeAtomic(root: string, relPath: string, content: Buffer) {
  const path = normalizeManagedPath(relPath);
  await assertNoSymlinkEscape(root, path);
  const dest = join(root, path);
  await mkdir(dirname(dest), { recursive: true });
  const tmp = join(dirname(dest), `.${path.split("/").at(-1)}.tmp-${randomBytes(4).toString("hex")}`);
  await writeFile(tmp, content);
  await rename(tmp, dest);
}

async function removeManaged(root: string, relPath: string) {
  const path = normalizeManagedPath(relPath);
  await assertNoSymlinkEscape(root, path);
  const dest = join(root, path);
  try {
    const stat = await lstat(dest);
    if (stat.isSymbolicLink()) throw new Error(`symlink not allowed: ${path}`);
    await rm(dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * Replace Hub-managed files only. Paths outside the previous managed list are left untouched.
 */
export async function applyManagedTree(
  root: string,
  files: ManagedWrite[],
): Promise<ApplyFilesResult> {
  await mkdir(root, { recursive: true });
  const next = new Map<string, { content: Buffer; sha256: string }>();
  for (const file of files) {
    const path = normalizeManagedPath(file.path);
    if (path === MANAGED_MANIFEST_PATH) continue;
    next.set(path, { content: file.content, sha256: sha256Buffer(file.content) });
  }

  const previous = await readManagedList(root);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [path, file] of next) {
    const prev = previous[path];
    if (!prev) added.push(path);
    else if (prev !== file.sha256) changed.push(path);
    await writeAtomic(root, path, file.content);
  }
  for (const path of Object.keys(previous)) {
    if (!next.has(path)) {
      removed.push(path);
      await removeManaged(root, path);
    }
  }

  const listing: Record<string, string> = {};
  for (const [path, file] of next) listing[path] = file.sha256;
  const managedBody = Buffer.from(`${JSON.stringify({ version: 1, files: listing }, null, 2)}\n`);
  await writeAtomic(root, MANAGED_MANIFEST_PATH, managedBody);

  return {
    added,
    removed,
    changed,
    manifest: {
      ...listing,
      [MANAGED_MANIFEST_PATH]: sha256Buffer(managedBody),
    },
  };
}
