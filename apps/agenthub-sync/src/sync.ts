import { createPublicKey, verify } from "node:crypto";
import { mtlsFetch, type SyncTls } from "./mtls-fetch.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { materializeCommonTree } from "@agenthub/common-fs";
import {
  applyManagedTree,
  canonicalJson,
  mergeRenderedOpencode,
  sha256Buffer,
} from "@agenthub/config-bundle";

export type SyncTask = {
  id: string;
  type: "apply" | "common" | "git_seed";
  manifest: Record<string, string>;
  urls: string[];
  signature: string;
};

type PayloadFile = { path: string; sha256: string; contentBase64: string };

export function verifyTaskSignature(
  publicKeyPem: string,
  task: Omit<SyncTask, "signature">,
  signature: string,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(task)),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

async function postResult(
  fetchImpl: typeof fetch,
  hubUrl: string,
  token: string,
  taskId: string,
  body: unknown,
) {
  await fetchImpl(`${hubUrl.replace(/\/$/, "")}/v1/sync/tasks/${taskId}/result`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function syncOnce(options: {
  hubUrl: string;
  token: string;
  workdir: string;
  publicKey: string;
  fetchImpl?: typeof fetch;
  reloadUrl?: string;
  /** Present a Hub-issued client certificate. The sync token is still required. */
  tls?: SyncTls;
}): Promise<{ applied: number }> {
  const fetchImpl = options.fetchImpl ?? (options.tls ? mtlsFetch(options.tls) : fetch);
  const hubUrl = options.hubUrl.replace(/\/$/, "");
  const listed = await fetchImpl(`${hubUrl}/v1/sync/tasks?wait=0`, {
    headers: { authorization: `Bearer ${options.token}` },
  });
  if (!listed.ok) throw new Error(`sync list failed: ${listed.status}`);
  const page = (await listed.json()) as { tasks: SyncTask[] };
  let applied = 0;

  for (const task of page.tasks) {
    const { signature, ...signed } = task;
    try {
      if (!verifyTaskSignature(options.publicKey, signed, signature)) {
        throw new Error("任务签名无效");
      }
      const downloaded: { path: string; content: Buffer; sha256: string }[] = [];
      for (const url of task.urls) {
        const response = await fetchImpl(url, {
          headers: { authorization: `Bearer ${options.token}` },
        });
        if (!response.ok) throw new Error(`download failed: ${response.status}`);
        const payload = (await response.json()) as { files: PayloadFile[] };
        for (const file of payload.files) {
          const bytes = Buffer.from(file.contentBase64, "base64");
          if (sha256Buffer(bytes) !== file.sha256) {
            throw new Error(`摘要不一致: ${file.path}`);
          }
          downloaded.push({ path: file.path, content: bytes, sha256: file.sha256 });
        }
      }

      if (task.type === "common") {
        const written = await materializeCommonTree(
          options.workdir,
          downloaded.map((file) => ({ path: file.path, content: file.content })),
        );
        if (options.reloadUrl) {
          await fetchImpl(options.reloadUrl, { method: "POST" }).catch(() => undefined);
        }
        await postResult(fetchImpl, hubUrl, options.token, task.id, {
          status: "succeeded",
          manifest: written.manifest,
          added: written.added,
          removed: written.removed,
          changed: written.changed,
        });
        applied += 1;
        continue;
      }

      const files: { path: string; content: Buffer }[] = [];
      const accepted: Record<string, string> = {};
      for (const file of downloaded) {
        let content = file.content;
        if (file.path === "opencode.json") {
          try {
            const existing = await readFile(join(options.workdir, "opencode.json"), "utf8");
            content = Buffer.from(mergeRenderedOpencode(existing, file.content.toString("utf8")), "utf8");
          } catch {
            content = file.content;
          }
        }
        files.push({ path: file.path, content });
        accepted[file.path] = file.sha256;
      }
      const written = await applyManagedTree(options.workdir, files);
      if (options.reloadUrl) {
        await fetchImpl(options.reloadUrl, { method: "POST" }).catch(() => undefined);
      }
      await postResult(fetchImpl, hubUrl, options.token, task.id, {
        status: "succeeded",
        manifest: { ...written.manifest, ...accepted },
        added: written.added,
        removed: written.removed,
        changed: written.changed,
      });
      applied += 1;
    } catch (err) {
      await postResult(fetchImpl, hubUrl, options.token, task.id, {
        status: "failed",
        error: err instanceof Error ? err.message : "sync failed",
      }).catch(() => undefined);
      throw err;
    }
  }
  return { applied };
}
