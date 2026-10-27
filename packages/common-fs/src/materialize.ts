import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { randomBytes } from "node:crypto";
import { sha256Buffer } from "./keys.js";
import { COMMON_TREE_DIR, canonicalizePath } from "./path.js";

const MANIFEST_PATH = ".agenthub/common-manifest.json";

export type CommonMaterializeResult = {
  added: string[];
  removed: string[];
  changed: string[];
  manifest: Record<string, string>;
};

async function readManifest(root: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(root, MANIFEST_PATH), "utf8");
    const parsed = JSON.parse(raw) as { files?: Record<string, string> };
    return parsed.files ?? {};
  } catch {
    return {};
  }
}

async function unlockTree(dir: string) {
  await chmod(dir, 0o755);
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) await unlockTree(full);
    else await chmod(full, 0o644);
  }
}

async function removeTree(dir: string) {
  try {
    const stat = await lstat(dir);
    if (stat.isSymbolicLink()) {
      await rm(dir, { force: true });
      return;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  await unlockTree(dir);
  await rm(dir, { recursive: true, force: true });
}

async function lockTree(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) {
      throw new Error(`symlink not allowed: ${entry.name}`);
    }
    if (stat.isDirectory()) await lockTree(full);
    else await chmod(full, 0o444);
  }
  await chmod(dir, 0o555);
}

/**
 * Replace `<workspace>/project-common` with a read-only tree.
 * The directory swap needs write permission on the workspace root, not inside the tree.
 */
export async function materializeCommonTree(
  workspaceRoot: string,
  files: { path: string; content: Buffer }[],
): Promise<CommonMaterializeResult> {
  await mkdir(workspaceRoot, { recursive: true });
  const live = join(workspaceRoot, COMMON_TREE_DIR);
  try {
    const existing = await lstat(live);
    if (existing.isSymbolicLink()) {
      throw new Error("project-common symlink refused");
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const previous = await readManifest(workspaceRoot);
  const next = new Map<string, Buffer>();
  for (const file of files) {
    const path = canonicalizePath(file.path);
    next.set(path, file.content);
  }

  const staging = join(workspaceRoot, `.project-common.staging-${randomBytes(4).toString("hex")}`);
  const backup = join(workspaceRoot, `.project-common.bak-${randomBytes(4).toString("hex")}`);
  await mkdir(staging, { recursive: true });
  try {
    for (const [path, content] of next) {
      const dest = join(staging, ...path.split("/"));
      const rel = relative(staging, dest);
      if (rel.startsWith("..")) throw new Error(`path escapes project-common: ${path}`);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content);
    }
    await lockTree(staging);

    let moved = false;
    try {
      await lstat(live);
      await rename(live, backup);
      moved = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    try {
      await rename(staging, live);
    } catch (err) {
      if (moved) await rename(backup, live).catch(() => undefined);
      throw err;
    }
    if (moved) await removeTree(backup);
  } finally {
    await removeTree(staging);
  }

  const manifest: Record<string, string> = {};
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [path, content] of next) {
    const sha = sha256Buffer(content);
    manifest[path] = sha;
    if (!previous[path]) added.push(path);
    else if (previous[path] !== sha) changed.push(path);
  }
  for (const path of Object.keys(previous)) {
    if (!next.has(path)) removed.push(path);
  }

  const manifestDir = join(workspaceRoot, ".agenthub");
  await mkdir(manifestDir, { recursive: true });
  await writeFile(
    join(workspaceRoot, MANIFEST_PATH),
    `${JSON.stringify({ version: 1, files: manifest }, null, 2)}\n`,
  );
  return { added, removed, changed, manifest };
}
