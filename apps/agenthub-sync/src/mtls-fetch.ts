import https from "node:https";

export type SyncTls = { cert: string; key: string; ca: string };

function headerRecord(headers: RequestInit["headers"]): Record<string, string> {
  if (!headers) return {};
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  const bag = headers as { forEach?: (fn: (value: string, key: string) => void) => void };
  if (typeof bag.forEach === "function") {
    const out: Record<string, string> = {};
    bag.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return { ...(headers as Record<string, string>) };
}

/** fetch-shaped client that presents a Hub CA client certificate. */
export function mtlsFetch(tls: SyncTls): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const target = new URL(url);
    const method = init?.method ?? "GET";
    const payload = typeof init?.body === "string" ? init.body : "";
    const headers = headerRecord(init?.headers);
    if (payload) headers["content-length"] = String(Buffer.byteLength(payload));
    const text = await new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method,
          cert: tls.cert,
          key: tls.key,
          ca: tls.ca,
          rejectUnauthorized: true,
          servername: target.hostname,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk as Buffer));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            resolve(JSON.stringify({ __status: res.statusCode ?? 0, __body: body }));
          });
        },
      );
      req.setTimeout(20_000, () => req.destroy(new Error("sync mTLS timed out")));
      req.on("error", reject);
      req.end(payload);
    });
    const parsed = JSON.parse(text) as { __status: number; __body: string };
    return new Response(parsed.__body, {
      status: parsed.__status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}
