import { syncOnce } from "./sync.js";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const hub = arg("--hub");
  const token = arg("--token");
  const workdir = arg("--workdir");
  const publicKey = arg("--public-key");
  if (!hub || !token || !workdir || !publicKey) {
    console.error(
      "usage: agenthub-sync --hub URL --token TOKEN --workdir DIR --public-key PEM [--reload URL] [--once]",
    );
    process.exit(1);
  }
  const once = process.argv.includes("--once");
  const reloadUrl = arg("--reload");
  do {
    const result = await syncOnce({
      hubUrl: hub,
      token,
      workdir,
      publicKey: publicKey.replace(/\\n/g, "\n"),
      ...(reloadUrl ? { reloadUrl } : {}),
    });
    if (result.applied > 0) console.log(`applied ${result.applied}`);
    if (!once) await new Promise((resolve) => setTimeout(resolve, 2000));
  } while (!once);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
