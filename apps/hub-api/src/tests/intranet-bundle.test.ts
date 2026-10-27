import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "dry-run") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|css|html|js|jsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("intranet bundle and browser egress", () => {
  it("dry-runs the offline bundle without a package registry or image pull", () => {
    const script = join(root, "scripts/build-offline-bundle.sh");
    const source = readFileSync(script, "utf8");
    const commands = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(commands).not.toMatch(/(^|[;&|\s])(npm|pnpm)(\s|$)/);
    expect(commands).not.toMatch(/docker\s+pull/);

    const out = join(root, "deploy/offline-bundle/dry-run");
    execFileSync("bash", [script], { cwd: root, env: { ...process.env, OFFLINE_BUNDLE_OUT: out } });
    expect(existsSync(join(out, "VERSION.txt"))).toBe(true);
    expect(existsSync(join(out, "checksums.sha256"))).toBe(true);
    expect(existsSync(join(out, "configs/compose.intranet.yml"))).toBe(true);
    expect(existsSync(join(out, "migrations/0000_p0_identity.sql"))).toBe(true);
    const version = readFileSync(join(out, "VERSION.txt"), "utf8");
    expect(version).toContain("mode=dry-run");
    expect(version).toContain("profile=intranet");
  });

  it("keeps the intranet compose file and the SPA free of public runtime URLs", () => {
    const compose = readFileSync(join(root, "deploy/compose/compose.intranet.yml"), "utf8");
    expect(compose).not.toMatch(/https?:\/\//);

    const banned = [
      "fonts.googleapis.com",
      "fonts.gstatic.com",
      "unpkg.com",
      "jsdelivr.net",
      "cdnjs.cloudflare.com",
    ];
    const files = [
      ...walk(join(root, "apps/hub-shell")),
      ...walk(join(root, "packages/workbench/src")),
      ...walk(join(root, "packages/hub-ui-kit/src")),
      ...walk(join(root, "packages/agent-client/src")),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const host of banned) {
        expect(text, file).not.toContain(host);
      }
    }
  });
});
