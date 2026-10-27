import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { createClaudeApp } from "./app.js";
import { createSdkEngine } from "./engine.js";

export { createClaudeApp } from "./app.js";
export { listenClaudeWorker } from "./listen.js";
export { ClaudeRuntime } from "./runtime.js";
export { mockClaudeEngine, createSdkEngine } from "./engine.js";

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const token = process.env.BOOT_TOKEN ?? "";
  const mock = process.env.CLAUDE_MOCK !== "0";
  const { app } = createClaudeApp({
    token,
    cwd: process.env.WORKSPACE_DIR ?? "/workspace",
    ...(mock ? {} : { engine: createSdkEngine() }),
  });
  const port = Number(process.env.PORT ?? 4096);
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
    console.log(`worker-claude listening on ${info.port}`);
  });
}
