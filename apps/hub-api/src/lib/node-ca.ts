import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const pending = new Map<string, Promise<NodeCa>>();

export type NodeCa = {
  dir: string;
  caPem: string;
  hubClientCert: string;
  hubClientKey: string;
  syncClientCert: string;
  syncClientKey: string;
  hubServerCert: string;
  hubServerKey: string;
  signCsr(csrPem: string): Promise<{ certPem: string; notAfter: Date }>;
};

async function openssl(args: string[]) {
  try {
    await exec("openssl", args, { maxBuffer: 2_000_000 });
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err ? String((err as { stderr?: unknown }).stderr) : "";
    throw new Error(`openssl failed: ${stderr || (err instanceof Error ? err.message : "unknown")}`);
  }
}

async function writeExtFiles(dir: string) {
  await writeFile(
    path.join(dir, "server.ext"),
    [
      "basicConstraints=CA:FALSE",
      "subjectAltName=IP:127.0.0.1,DNS:localhost",
      "extendedKeyUsage=serverAuth,clientAuth",
      "keyUsage=digitalSignature",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(dir, "client.ext"),
    ["basicConstraints=CA:FALSE", "extendedKeyUsage=clientAuth", "keyUsage=digitalSignature", ""].join("\n"),
  );
}

async function issueFromCsr(ca: { dir: string; caPem: string }, csrPem: string, days: number, extName: string) {
  const csrPath = path.join(ca.dir, `sign-${Date.now()}-${Math.random().toString(16).slice(2)}.csr`);
  const certPath = `${csrPath}.crt`;
  await writeFile(csrPath, csrPem, { mode: 0o600 });
  try {
    await openssl([
      "x509",
      "-req",
      "-in",
      csrPath,
      "-CA",
      path.join(ca.dir, "ca.pem"),
      "-CAkey",
      path.join(ca.dir, "ca.key"),
      "-CAcreateserial",
      "-out",
      certPath,
      "-days",
      String(days),
      "-sha256",
      "-extfile",
      path.join(ca.dir, extName),
    ]);
    const certPem = await readFile(certPath, "utf8");
    const notAfter = new Date(new X509Certificate(certPem).validTo);
    return { certPem, notAfter };
  } finally {
    await rm(csrPath, { force: true }).catch(() => undefined);
    await rm(certPath, { force: true }).catch(() => undefined);
  }
}

async function loadOrCreate(dir: string): Promise<NodeCa> {
  await mkdir(dir, { recursive: true });
  await writeExtFiles(dir);
  const caKey = path.join(dir, "ca.key");
  const caPemPath = path.join(dir, "ca.pem");
  try {
    await readFile(caPemPath, "utf8");
  } catch {
    await openssl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", caKey]);
    await openssl([
      "req",
      "-new",
      "-x509",
      "-key",
      caKey,
      "-out",
      caPemPath,
      "-days",
      "3650",
      "-sha256",
      "-subj",
      "/CN=agenthub-hub-ca",
    ]);
  }

  async function selfSignedRole(name: string, subject: string, extName: string) {
    const keyPath = path.join(dir, `${name}.key`);
    const certPath = path.join(dir, `${name}.crt`);
    try {
      return {
        key: await readFile(keyPath, "utf8"),
        cert: await readFile(certPath, "utf8"),
      };
    } catch {
      await openssl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", keyPath]);
      const csrPath = path.join(dir, `${name}.csr`);
      await openssl(["req", "-new", "-key", keyPath, "-out", csrPath, "-subj", subject]);
      const signed = await issueFromCsr(
        { dir, caPem: await readFile(caPemPath, "utf8") },
        await readFile(csrPath, "utf8"),
        825,
        extName,
      );
      await writeFile(certPath, signed.certPem, { mode: 0o600 });
      return { key: await readFile(keyPath, "utf8"), cert: signed.certPem };
    }
  }

  const server = await selfSignedRole("hub-server", "/CN=agenthub-hub", "server.ext");
  const client = await selfSignedRole("hub-client", "/CN=hub-control", "client.ext");
  const sync = await selfSignedRole("sync-client", "/CN=agenthub-sync", "client.ext");
  const caPem = await readFile(caPemPath, "utf8");
  return {
    dir,
    caPem,
    hubClientCert: client.cert,
    hubClientKey: client.key,
    syncClientCert: sync.cert,
    syncClientKey: sync.key,
    hubServerCert: server.cert,
    hubServerKey: server.key,
    signCsr(csrPem: string) {
      return issueFromCsr({ dir, caPem }, csrPem, 90, "server.ext");
    },
  };
}

export function ensureNodeCa(dir: string): Promise<NodeCa> {
  const abs = path.resolve(dir);
  let job = pending.get(abs);
  if (!job) {
    job = loadOrCreate(abs).catch((err) => {
      pending.delete(abs);
      throw err;
    });
    pending.set(abs, job);
  }
  return job;
}

export function fingerprintPem(pem: string): string {
  return new X509Certificate(pem).fingerprint256.replace(/:/g, "").toLowerCase();
}
