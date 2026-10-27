import { X509Certificate } from "node:crypto";
import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import type { Hono } from "hono";

export function fingerprintPem(pem: string): string {
  return new X509Certificate(pem).fingerprint256.replace(/:/g, "").toLowerCase();
}

export function httpsJson(
  url: string,
  init: {
    method?: string;
    body?: unknown;
    cert: string;
    key: string;
    ca: string;
    timeoutMs?: number;
  },
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
        cert: init.cert,
        key: init.key,
        ca: init.ca,
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
              body = { error: { code: "DOCKER_ERROR", message: text.slice(0, 300) } };
            }
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.setTimeout(init.timeoutMs ?? 20_000, () => req.destroy(new Error("mTLS request timed out")));
    req.on("error", reject);
    req.end(payload);
  });
}

export function listenMtls(app: Hono, tls: { cert: string; key: string; ca: string }, port = 0) {
  const listener = getRequestListener((request) => app.fetch(request));
  const server = https.createServer(
    {
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
    (req: IncomingMessage, res: ServerResponse) => {
      const socket = req.socket as import("node:tls").TLSSocket;
      if (!socket.authorized) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: { code: "CERT_EXPIRED", message: "client certificate rejected" } }));
        return;
      }
      listener(req, res);
    },
  );
  return new Promise<{ port: number; close: () => Promise<void>; setIdentity: (cert: string, key: string) => void }>(
    (resolve) => {
      server.listen(port, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        resolve({
          port: address.port,
          close: () =>
            new Promise((done) => {
              server.close(() => done());
            }),
          setIdentity(cert: string, key: string) {
            server.setSecureContext({ cert, key, ca: tls.ca });
          },
        });
      });
    },
  );
}
