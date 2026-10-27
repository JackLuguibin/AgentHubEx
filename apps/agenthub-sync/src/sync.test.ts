import { generateKeyPairSync, sign } from "node:crypto";
import https from "node:https";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureNodeCa } from "../../hub-api/src/lib/node-ca.ts";
import { canonicalJson, sha256Buffer } from "@agenthub/config-bundle";
import { describe, expect, it } from "vitest";
import { syncOnce } from "./sync.js";

function signedTask(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  body: { id: string; type: "apply" | "common"; manifest: Record<string, string>; urls: string[] },
) {
  const signature = sign(null, Buffer.from(canonicalJson(body)), privateKey).toString("base64url");
  return { ...body, signature };
}

describe("agenthub-sync", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  it("writes the signed bundle, keeps user files, and rejects path escape", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "ah-sync-"));
    await writeFile(join(workdir, "notes.txt"), "keep me");
    await writeFile(join(workdir, "opencode.json"), JSON.stringify({ theme: "user" }));

    const agents = Buffer.from("build\n");
    const config = Buffer.from(
      `${JSON.stringify({ agent: { build: { prompt: "v1" } }, agenthub: { managed: true } }, null, 2)}\n`,
    );
    const files = [
      { path: "opencode.json", sha256: sha256Buffer(config), contentBase64: config.toString("base64") },
      { path: ".opencode/agents/build.md", sha256: sha256Buffer(agents), contentBase64: agents.toString("base64") },
    ];
    const manifest = Object.fromEntries(files.map((file) => [file.path, file.sha256]));
    const task = signedTask(privateKey, {
      id: "job-1",
      type: "apply",
      manifest,
      urls: ["https://hub.test/v1/sync/payloads/job-1"],
    });
    let resultBody: { status?: string } = {};

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/sync/tasks?") && (!init || init.method == null || init.method === "GET")) {
        return new Response(JSON.stringify({ tasks: [task] }), { status: 200 });
      }
      if (url.includes("/payloads/")) {
        return new Response(JSON.stringify({ files }), { status: 200 });
      }
      if (url.includes("/result")) {
        resultBody = JSON.parse(String(init?.body ?? "{}")) as { status?: string };
        return new Response("{}", { status: 200 });
      }
      return new Response("missing", { status: 404 });
    };

    const applied = await syncOnce({
      hubUrl: "https://hub.test",
      token: "st1.test",
      workdir,
      publicKey: publicPem,
      fetchImpl,
    });
    expect(applied.applied).toBe(1);
    expect(resultBody.status).toBe("succeeded");
    expect(await readFile(join(workdir, "notes.txt"), "utf8")).toBe("keep me");
    expect(await readFile(join(workdir, ".opencode/agents/build.md"), "utf8")).toBe("build\n");
    const written = JSON.parse(await readFile(join(workdir, "opencode.json"), "utf8")) as {
      theme?: string;
      agent?: { build?: { prompt?: string } };
    };
    expect(written.theme).toBe("user");
    expect(written.agent?.build?.prompt).toBe("v1");

    const escape = Buffer.from("nope");
    const badFiles = [
      { path: "../escape.txt", sha256: sha256Buffer(escape), contentBase64: escape.toString("base64") },
    ];
    const badBody = {
      id: "job-2",
      type: "apply" as const,
      manifest: { "../escape.txt": badFiles[0]!.sha256 },
      urls: ["https://hub.test/v1/sync/payloads/job-2"],
    };
    const badTask = signedTask(privateKey, badBody);
    const badFetch: typeof fetch = async (input, _init) => {
      const url = String(input);
      if (url.includes("/sync/tasks?")) {
        return new Response(JSON.stringify({ tasks: [badTask] }), { status: 200 });
      }
      if (url.includes("/payloads/")) return new Response(JSON.stringify({ files: badFiles }), { status: 200 });
      if (url.includes("/result")) return new Response("{}", { status: 200 });
      return new Response("missing", { status: 404 });
    };
    await expect(
      syncOnce({
        hubUrl: "https://hub.test",
        token: "st1.test",
        workdir,
        publicKey: publicPem,
        fetchImpl: badFetch,
      }),
    ).rejects.toThrow(/unsafe path/);
    expect(await readFile(join(workdir, "notes.txt"), "utf8")).toBe("keep me");
  });

  it("rejects a bad signature before writing", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "ah-sync-bad-"));
    const fetchImpl: typeof fetch = async (input, _init) => {
      const url = String(input);
      if (url.includes("/sync/tasks?")) {
        return new Response(
          JSON.stringify({
            tasks: [
              {
                id: "job-x",
                type: "apply",
                manifest: {},
                urls: [],
                signature: "aaaa",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/result")) return new Response("{}", { status: 200 });
      return new Response("missing", { status: 404 });
    };
    await expect(
      syncOnce({
        hubUrl: "https://hub.test",
        token: "st1.test",
        workdir,
        publicKey: publicPem,
        fetchImpl,
      }),
    ).rejects.toThrow(/签名/);
  });

  it("materializes project-common as a read-only tree", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "ah-sync-common-"));
    const spec = Buffer.from("# spec\n");
    const files = [
      { path: "docs/spec.md", sha256: sha256Buffer(spec), contentBase64: spec.toString("base64") },
    ];
    const task = signedTask(privateKey, {
      id: "job-common",
      type: "common",
      manifest: { "docs/spec.md": files[0]!.sha256 },
      urls: ["https://hub.test/v1/sync/payloads/job-common"],
    });
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/sync/tasks?") && (!init || init.method == null || init.method === "GET")) {
        return new Response(JSON.stringify({ tasks: [task] }), { status: 200 });
      }
      if (url.includes("/payloads/")) return new Response(JSON.stringify({ files }), { status: 200 });
      if (url.includes("/result")) return new Response("{}", { status: 200 });
      return new Response("missing", { status: 404 });
    };
    const applied = await syncOnce({
      hubUrl: "https://hub.test",
      token: "st1.test",
      workdir,
      publicKey: publicPem,
      fetchImpl,
    });
    expect(applied.applied).toBe(1);
    const target = join(workdir, "project-common", "docs", "spec.md");
    expect(await readFile(target, "utf8")).toBe("# spec\n");
    await expect(writeFile(target, "nope")).rejects.toThrow();
  });

  it("talks to the hub mTLS port with a client certificate and still sends the token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ah-sync-mtls-"));
    const ca = await ensureNodeCa(dir);
    const server = https.createServer(
      {
        cert: ca.hubServerCert,
        key: ca.hubServerKey,
        ca: ca.caPem,
        requestCert: true,
        rejectUnauthorized: true,
      },
      (req, res) => {
        const authed = req.headers.authorization === "Bearer sync-token";
        res.writeHead(authed ? 200 : 401, { "content-type": "application/json" });
        res.end(authed ? JSON.stringify({ tasks: [] }) : JSON.stringify({ error: { message: "token" } }));
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      await expect(
        syncOnce({
          hubUrl: `https://127.0.0.1:${port}`,
          token: "sync-token",
          workdir: dir,
          publicKey: publicPem,
        }),
      ).rejects.toThrow();
      const applied = await syncOnce({
        hubUrl: `https://127.0.0.1:${port}`,
        token: "sync-token",
        workdir: dir,
        publicKey: publicPem,
        tls: { cert: ca.syncClientCert, key: ca.syncClientKey, ca: ca.caPem },
      });
      expect(applied.applied).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });
});
