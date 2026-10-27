import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Capacity, DockerControl } from "./docker.js";
import { createNodeApp } from "./app.js";
import { fingerprintPem, httpsJson, listenMtls } from "./mtls.js";

const exec = promisify(execFile);

export type BootOptions = {
  hubUrl: string;
  hubMtlsUrl: string;
  bootstrapToken?: string;
  docker: DockerControl;
  bindHost?: string;
  workspaceRoot: string;
  commonRoot: string;
  stateDir: string;
  labels?: Record<string, string>;
  capacity: Capacity;
  agentVersion?: string;
  image?: string;
};

type StateFile = { nodeId: string };

async function openssl(args: string[]) {
  try {
    await exec("openssl", args);
  } catch (err) {
    const stderr = err instanceof Error && "stderr" in err ? String((err as { stderr?: unknown }).stderr) : "";
    throw new Error(`openssl failed: ${stderr || (err instanceof Error ? err.message : "unknown")}`);
  }
}

async function ensureKey(stateDir: string): Promise<{ keyPath: string; keyPem: string }> {
  const keyPath = path.join(stateDir, "node.key");
  try {
    const keyPem = await readFile(keyPath, "utf8");
    return { keyPath, keyPem };
  } catch {
    await openssl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", keyPath]);
    return { keyPath, keyPem: await readFile(keyPath, "utf8") };
  }
}

async function makeCsr(keyPath: string, csrPath: string) {
  await openssl(["req", "-new", "-key", keyPath, "-out", csrPath, "-subj", "/CN=agenthub-node"]);
}

export async function bootNodeAgent(opts: BootOptions) {
  const bindHost = opts.bindHost ?? "127.0.0.1";
  const agentVersion = opts.agentVersion ?? "0.1.0";
  const image = opts.image ?? "agenthub/worker-opencode";
  await mkdir(opts.stateDir, { recursive: true });
  await mkdir(opts.workspaceRoot, { recursive: true });
  await mkdir(opts.commonRoot, { recursive: true });

  const { keyPath, keyPem } = await ensureKey(opts.stateDir);
  const statePath = path.join(opts.stateDir, "node.json");
  let certPem: string;
  let caPem: string;
  let nodeId: string;

  const haveCert = await readFile(path.join(opts.stateDir, "node.crt"), "utf8").then(
    (value) => value,
    () => "",
  );
  const haveCa = await readFile(path.join(opts.stateDir, "ca.pem"), "utf8").then(
    (value) => value,
    () => "",
  );
  let saved: StateFile | null = null;
  try {
    saved = JSON.parse(await readFile(statePath, "utf8")) as StateFile;
  } catch {
    saved = null;
  }

  if (haveCert && haveCa && saved?.nodeId) {
    certPem = haveCert;
    caPem = haveCa;
    nodeId = saved.nodeId;
  } else {
    if (!opts.bootstrapToken) throw new Error("BOOTSTRAP_TOKEN is required to register this node");
    const csrPath = path.join(opts.stateDir, "node.csr");
    await makeCsr(keyPath, csrPath);
    const csr = await readFile(csrPath, "utf8");
    const res = await fetch(new URL("/v1/nodes/register", opts.hubUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: opts.bootstrapToken,
        csr,
        capacity: opts.capacity,
        labels: opts.labels ?? {},
        agentVersion,
        hostname: bindHost,
      }),
    });
    const body = (await res.json()) as {
      nodeId?: string;
      cert?: string;
      caBundle?: string;
      error?: { code?: string; message?: string };
    };
    if (!res.ok || !body.cert || !body.caBundle || !body.nodeId) {
      throw new Error(body.error?.message ?? `register failed (${res.status})`);
    }
    certPem = body.cert;
    caPem = body.caBundle;
    nodeId = body.nodeId;
    await writeFile(path.join(opts.stateDir, "node.crt"), certPem, { mode: 0o600 });
    await writeFile(path.join(opts.stateDir, "ca.pem"), caPem, { mode: 0o600 });
    await writeFile(statePath, JSON.stringify({ nodeId }), { mode: 0o600 });
  }

  const runtime = createNodeApp({
    docker: opts.docker,
    capacity: opts.capacity,
    workspaceRoot: opts.workspaceRoot,
    commonRoot: opts.commonRoot,
    bindIp: bindHost,
    agentVersion,
  });
  const tls = await listenMtls(runtime.app, { cert: certPem, key: keyPem, ca: caPem });
  const advertiseUrl = `https://${bindHost}:${tls.port}`;

  async function heartbeat() {
    const used = await opts.docker.usage();
    const workspaces = await opts.docker.list();
    const result = await httpsJson(new URL("/v1/nodes/heartbeat", opts.hubMtlsUrl).toString(), {
      cert: certPem,
      key: keyPem,
      ca: caPem,
      body: {
        used: {
          cpu: used.cpu,
          memMb: used.memMb,
          diskGb: used.diskGb,
          workspaces: used.workspaces,
        },
        workspaces,
        agentVersion,
        wallTime: new Date().toISOString(),
        advertiseUrl,
      },
    });
    const commands =
      result.body && typeof result.body === "object" && "commands" in result.body
        ? (result.body as { commands?: Array<{ type?: string }> }).commands ?? []
        : [];
    if (commands.some((command) => command.type === "drain")) runtime.setDraining(true);
    if (commands.some((command) => command.type === "renew_cert_hint")) {
      const csrPath = path.join(opts.stateDir, "renew.csr");
      await makeCsr(keyPath, csrPath);
      const csr = await readFile(csrPath, "utf8");
      const renewed = await httpsJson(new URL("/v1/nodes/cert/renew", opts.hubMtlsUrl).toString(), {
        cert: certPem,
        key: keyPem,
        ca: caPem,
        body: { csr },
      });
      const next =
        renewed.body && typeof renewed.body === "object" && "cert" in renewed.body
          ? String((renewed.body as { cert?: string }).cert ?? "")
          : "";
      if (renewed.status < 300 && next) {
        certPem = next;
        await writeFile(path.join(opts.stateDir, "node.crt"), certPem, { mode: 0o600 });
        tls.setIdentity(certPem, keyPem);
      }
    }
    return result;
  }

  const first = await heartbeat();
  if (first.status >= 300) {
    await tls.close();
    throw new Error(`heartbeat failed (${first.status})`);
  }
  const timer = setInterval(() => {
    heartbeat().catch((err) => {
      console.warn("node heartbeat failed", err instanceof Error ? err.message : err);
    });
  }, 15_000);
  timer.unref?.();

  return {
    nodeId,
    port: tls.port,
    advertiseUrl,
    fingerprint: fingerprintPem(certPem),
    image,
    docker: opts.docker,
    app: runtime.app,
    heartbeat,
    async close() {
      clearInterval(timer);
      await tls.close();
    },
  };
}
