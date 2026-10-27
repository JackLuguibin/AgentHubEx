import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

describe("provider keys stay out of the browser", () => {
  it("does not persist tokens or provider keys in web storage", () => {
    const files = [
      ...walk(join(root, "apps/hub-shell/src")),
      ...walk(join(root, "packages/workbench/src")),
      ...walk(join(root, "packages/agent-client/src")),
    ];
    expect(files.length).toBeGreaterThan(0);
    const banned = ["localStorage", "sessionStorage", "indexedDB"];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const api of banned) {
        expect(text, `${file} uses ${api}`).not.toContain(api);
      }
    }
  });
});
