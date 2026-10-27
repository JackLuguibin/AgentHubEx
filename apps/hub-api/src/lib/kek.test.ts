import http from "node:http";
import { describe, expect, it } from "vitest";
import { openSecret, sealWrapped, secretAad } from "./envelope.js";
import { httpKek } from "./kek.js";

const aad = secretAad({ tenantId: "t1", kind: "node", id: "node-1", version: 1 });

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

describe("intranet KMS", () => {
  it("wraps and unwraps without ever exporting the key", async () => {
    const stored = new Map<string, string>();
    let exports = 0;
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        if (req.url === "/v1/export") {
          exports += 1;
          res.writeHead(403);
          res.end();
          return;
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
          plaintext?: string;
          ciphertext?: string;
        };
        if (req.url === "/v1/wrap" && body.plaintext) {
          const id = `w${stored.size}`;
          stored.set(id, body.plaintext);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ciphertext: Buffer.from(id).toString("base64"), version: 3 }));
          return;
        }
        if (req.url === "/v1/unwrap" && body.ciphertext) {
          const id = Buffer.from(body.ciphertext, "base64").toString("utf8");
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ plaintext: stored.get(id) ?? "" }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    const port = await listen(server);
    try {
      const kek = httpKek({ url: `http://127.0.0.1:${port}`, token: "kms-token", version: 3 });
      expect(() => kek.exportKey()).toThrow(/export is forbidden/);
      const sealed = await sealWrapped("node-password", aad, kek);
      expect(sealed.version).toBe(3);
      expect(sealed.blob.toString("utf8")).not.toContain("node-password");
      const opened = await openSecret(sealed.blob, {
        platformDek: "dev-platform-dek-32bytes-minimum!!",
        kek,
        aad,
      });
      expect(opened).toBe("node-password");
      const denied = await fetch(`http://127.0.0.1:${port}/v1/export`);
      expect(denied.status).toBe(403);
      expect(exports).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
