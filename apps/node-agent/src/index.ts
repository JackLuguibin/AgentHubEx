import path from "node:path";
import { FakeDocker, type Capacity } from "./docker.js";
import { bootNodeAgent } from "./boot.js";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const capacity: Capacity = {
  cpu: num("CAPACITY_CPU", 8),
  memMb: num("CAPACITY_MEM_MB", 16384),
  diskGb: num("CAPACITY_DISK_GB", 200),
  maxWorkspaces: num("CAPACITY_MAX_WORKSPACES", 20),
};

const hubUrl = process.env.AGENTHUB_URL;
if (!hubUrl) {
  console.error("AGENTHUB_URL is required");
  process.exit(1);
}

const labels = process.env.NODE_LABELS ? (JSON.parse(process.env.NODE_LABELS) as Record<string, string>) : {};
const dockerMode = process.env.NODE_AGENT_DOCKER ?? "dockerode";

const docker =
  dockerMode === "fake"
    ? new FakeDocker(capacity)
    : await import("./dockerode-driver.js").then((mod) => new mod.DockerodeDriver(capacity));

const running = await bootNodeAgent({
  hubUrl,
  hubMtlsUrl: process.env.HUB_MTLS_URL ?? hubUrl,
  bootstrapToken: process.env.BOOTSTRAP_TOKEN,
  docker,
  bindHost: process.env.NODE_BIND_HOST ?? "127.0.0.1",
  workspaceRoot: path.resolve(process.env.WORKSPACE_ROOT ?? "data/node-workspaces"),
  commonRoot: path.resolve(process.env.COMMON_ROOT ?? "data/node-common"),
  stateDir: path.resolve(process.env.STATE_DIR ?? "data/node-agent"),
  labels,
  capacity,
  agentVersion: process.env.AGENT_VERSION ?? "0.1.0",
  image: process.env.WORKER_IMAGE ?? "agenthub/worker-opencode",
});

console.log(`node-agent ${running.nodeId} listening on ${running.advertiseUrl}`);
