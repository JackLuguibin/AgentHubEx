import https from "node:https";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import type { NodeCa } from "./node-ca.js";
import { nodePeer, peerFromSocket } from "./node-peer.js";
import type tls from "node:tls";

export function startHubNodeMtls(
  app: { fetch: (request: Request) => Response | Promise<Response> },
  ca: NodeCa,
  port = 0,
) {
  const listener = getRequestListener((request, env) => {
    const socket = env.incoming.socket as tls.TLSSocket;
    return nodePeer.run(peerFromSocket(socket), () => app.fetch(request));
  });
  const server = https.createServer(
    {
      cert: ca.hubServerCert,
      key: ca.hubServerKey,
      ca: ca.caPem,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
    (req: IncomingMessage, res: ServerResponse) => {
      listener(req, res);
    },
  );
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
