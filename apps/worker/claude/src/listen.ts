import { serve } from "@hono/node-server";
import { createClaudeApp, type ClaudeAppOptions } from "./app.js";

export function listenClaudeWorker(opts: ClaudeAppOptions & { port?: number }) {
  const { app, runtime } = createClaudeApp(opts);
  return new Promise<{ url: string; runtime: typeof runtime; close: () => Promise<void> }>((resolve) => {
    const server = serve(
      {
        fetch: app.fetch,
        port: opts.port ?? 0,
        hostname: "127.0.0.1",
      },
      (info) => {
        resolve({
          url: `http://127.0.0.1:${info.port}`,
          runtime,
          close: () => closeServer(server),
        });
      },
    );
  });
}

function closeServer(server: {
  closeAllConnections?: () => void;
  close: (callback: (err?: Error) => void) => void;
}) {
  server.closeAllConnections?.();
  return new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
