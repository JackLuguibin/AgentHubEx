import https from "node:https";
import { AppError } from "../errors.js";

export type NodeTls = { cert: string; key: string; ca: string };

export function httpsJson(
  url: string,
  init: { method?: string; body?: unknown; tls: NodeTls; timeoutMs?: number },
): Promise<{ status: number; body: unknown }> {
  const payload = init.body === undefined ? "" : JSON.stringify(init.body);
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? "POST",
        cert: init.tls.cert,
        key: init.tls.key,
        ca: init.tls.ca,
        rejectUnauthorized: true,
        servername: target.hostname,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: unknown = null;
          if (text) {
            try {
              body = JSON.parse(text);
            } catch {
              body = { error: { message: text.slice(0, 300) } };
            }
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.setTimeout(init.timeoutMs ?? 20_000, () => req.destroy(new Error("node agent timed out")));
    req.on("error", reject);
    req.end(payload);
  });
}

export async function callNode(
  baseUrl: string,
  pathname: string,
  tls: NodeTls,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const result = await httpsJson(new URL(pathname, baseUrl).toString(), { ...init, tls });
  if (result.status < 400) return result.body;
  const error =
    result.body && typeof result.body === "object" && "error" in result.body
      ? (result.body as { error?: { code?: string; message?: string } }).error
      : undefined;
  const message = error?.message ?? "node agent request failed";
  if (error?.code === "CAPACITY_EXCEEDED") return Promise.reject(new AppError(409, "CAPACITY_EXCEEDED", message));
  if (error?.code === "WORKSPACE_NOT_FOUND") {
    return Promise.reject(new AppError(404, "WORKSPACE_NOT_FOUND", message));
  }
  if (error?.code === "DOCKER_ERROR") return Promise.reject(new AppError(502, "DOCKER_ERROR", message));
  return Promise.reject(new AppError(502, "UPSTREAM_UNAVAILABLE", message));
}
