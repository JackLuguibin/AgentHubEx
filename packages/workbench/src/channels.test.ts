import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sessionEventsUrl } from "@agenthub/agent-client";

const srcDir = dirname(fileURLToPath(import.meta.url));

function sourceText() {
  return readdirSync(srcDir)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .filter((name) => !name.endsWith(".test.ts"))
    .map((name) => readFileSync(join(srcDir, name), "utf8"))
    .join("\n");
}

describe("A12 session channel", () => {
  it("opens session events only on the Hub Facade", () => {
    const url = sessionEventsUrl("https://hub.internal", "11111111-1111-1111-1111-111111111111");
    expect(url).toBe(
      "https://hub.internal/v1/sessions/11111111-1111-1111-1111-111111111111/events",
    );
    expect(url).not.toContain("/agent/event");
    expect(url).not.toContain("/agent/session");
  });

  it("does not call agent event/session paths or a raw node address", () => {
    const src = sourceText();
    expect(src).not.toMatch(/\/agent\/event/);
    expect(src).not.toMatch(/\/agent\/session/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/https?:\/\/\d+\.\d+\.\d+\.\d+/);
  });
});
