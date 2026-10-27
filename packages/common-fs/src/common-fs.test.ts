import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CommonFsError,
  assertQuota,
  assertWritable,
  canonicalizePath,
  isProtectedPath,
  materializeCommonTree,
  normalizeMime,
  objectKey,
  snapshotHash,
  snapshotObjectKey,
  withCommonWriteDeny,
} from "./index.js";

const sha = "a".repeat(64);

describe("canonicalizePath", () => {
  it("rejects traversal, absolute paths, control characters, and the reserved prefix", () => {
    for (const raw of ["../x", "/etc/passwd", "docs/../../x", "a/../b", ".agenthub/secret", "bad\u0000name"]) {
      expect(() => canonicalizePath(raw)).toThrow(CommonFsError);
    }
    expect(canonicalizePath("a\\b")).toBe("a/b");
    expect(canonicalizePath("docs/spec.md")).toBe("docs/spec.md");
    expect(canonicalizePath("docs/spec.md/")).toBe("docs/spec.md");
    expect(canonicalizePath("caf\u00e9.md")).toBe(canonicalizePath("cafe\u0301.md"));
  });

  it("rejects oversized segments", () => {
    expect(() => canonicalizePath(`${"a".repeat(256)}.md`)).toThrow(/过长/);
  });
});

describe("protected prefixes and keys", () => {
  it("blocks developer writes under a protected prefix", () => {
    expect(isProtectedPath("docs/spec.md", ["docs"])).toBe(true);
    expect(isProtectedPath("templates/a.md", ["docs"])).toBe(false);
    expect(() => assertWritable("docs/spec.md", ["docs"], false)).toThrow(/owner/);
    expect(assertWritable("docs/spec.md", ["docs"], true)).toBe("docs/spec.md");
  });

  it("builds content-addressed and snapshot keys", () => {
    expect(objectKey("tenant-1", "project-1", sha)).toBe(
      `tenants/tenant-1/projects/project-1/objects/${sha}`,
    );
    expect(snapshotObjectKey("tenant-1", "project-1", sha)).toBe(
      `tenants/tenant-1/projects/project-1/common-snapshots/${sha}.tar.zst`,
    );
    expect(snapshotHash([{ path: "b", checksum: sha }, { path: "a", checksum: sha }])).toBe(
      snapshotHash([{ path: "a", checksum: sha }, { path: "b", checksum: sha }]),
    );
    expect(() => objectKey("tenant-1", "../x", sha)).toThrow(CommonFsError);
  });
});

describe("mime and quota", () => {
  it("rejects executables and checks remaining quota", () => {
    expect(normalizeMime("docs/spec.md", "application/octet-stream")).toBe("text/markdown");
    expect(() => normalizeMime("tool.exe", "application/octet-stream")).toThrow(/可执行/);
    expect(() => assertQuota(10, 5, 14)).toThrow(/配额/);
    expect(() => assertQuota(10, 4, 14)).not.toThrow();
  });
});

describe("materialize and agent deny", () => {
  it("writes a read-only project-common tree and denies further writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ah-common-"));
    const first = await materializeCommonTree(root, [
      { path: "docs/spec.md", content: Buffer.from("# spec\n") },
    ]);
    expect(first.added).toEqual(["docs/spec.md"]);
    const target = join(root, "project-common", "docs", "spec.md");
    await expect(writeFile(target, "changed")).rejects.toThrow();
    await expect(writeFile(join(root, "project-common", "docs", "other.md"), "x")).rejects.toThrow();

    const second = await materializeCommonTree(root, [
      { path: "docs/spec.md", content: Buffer.from("# spec v2\n") },
    ]);
    expect(second.changed).toEqual(["docs/spec.md"]);
  });

  it("denies agent edit and write on project-common", () => {
    const permission = withCommonWriteDeny({ edit: "allow", bash: "allow" });
    expect(permission.edit).toMatchObject({ "*": "allow", "project-common/**": "deny" });
    expect(permission.write).toMatchObject({ "project-common/**": "deny" });
    expect(permission.bash).toBe("allow");
  });
});
