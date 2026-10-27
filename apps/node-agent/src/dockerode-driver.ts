import { chown, mkdir, rm } from "node:fs/promises";
import {
  buildContainerCreateOptions,
  WORKER_NETWORK,
  WORKER_PORT,
  type ContainerCreateOptions,
} from "./container-spec.js";
import {
  CapacityExceeded,
  WorkspaceNotFound,
  type Capacity,
  type CreatedWorkspace,
  type CreateWorkspaceInput,
  type DockerControl,
  type ListedWorkspace,
  type WorkspaceResources,
} from "./docker.js";

type DockerContainer = {
  id: string;
  start(): Promise<unknown>;
  stop(opts?: { t?: number }): Promise<unknown>;
  remove(opts?: { force?: boolean }): Promise<unknown>;
  inspect(): Promise<{
    State?: { Running?: boolean };
    NetworkSettings?: { Ports?: Record<string, Array<{ HostPort?: string }> | null> };
    HostConfig?: { NanoCpus?: number; Memory?: number };
    Config?: { Labels?: Record<string, string> };
  }>;
};

type DockerodeClient = {
  createNetwork(opts: Record<string, unknown>): Promise<unknown>;
  getNetwork(name: string): { inspect(): Promise<unknown> };
  createContainer(opts: ContainerCreateOptions): Promise<DockerContainer>;
  getContainer(id: string): DockerContainer;
  listContainers(opts: Record<string, unknown>): Promise<
    Array<{ Id: string; Labels?: Record<string, string>; State?: string }>
  >;
};

async function loadDocker(socketPath: string): Promise<DockerodeClient> {
  const mod = await import("dockerode");
  const Docker = mod.default as unknown as new (opts: { socketPath: string }) => DockerodeClient;
  return new Docker({ socketPath });
}

/**
 * dockerode driver. The worker container does not receive the Docker socket.
 * The image must already be present; this driver does not pull from a registry.
 */
export class DockerodeDriver implements DockerControl {
  readonly kind = "dockerode" as const;
  private client: DockerodeClient | null = null;

  constructor(
    private readonly capacity: Capacity,
    private readonly socketPath = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock",
  ) {}

  private async docker(): Promise<DockerodeClient> {
    if (!this.client) this.client = await loadDocker(this.socketPath);
    return this.client;
  }

  async ensureNetwork(): Promise<void> {
    const docker = await this.docker();
    try {
      await docker.getNetwork(WORKER_NETWORK).inspect();
    } catch {
      await docker.createNetwork({
        Name: WORKER_NETWORK,
        Driver: "bridge",
        CheckDuplicate: true,
        Options: { "com.docker.network.bridge.enable_icc": "false" },
      });
    }
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<CreatedWorkspace> {
    const docker = await this.docker();
    const existing = (await this.list()).find((row) => row.workspaceId === input.workspaceId);
    if (existing) {
      if (existing.state === "stopped") await this.start(input.workspaceId);
      const info = await docker.getContainer(existing.containerId).inspect();
      const port = info.NetworkSettings?.Ports?.[WORKER_PORT]?.[0]?.HostPort;
      return {
        containerId: existing.containerId,
        endpoint: port ? `http://${input.bindIp}:${port}` : `http://${input.bindIp}`,
        volumePath: input.volumePath,
        options: buildContainerCreateOptions(input),
      };
    }
    const used = await this.usage();
    if (
      used.workspaces + 1 > this.capacity.maxWorkspaces ||
      used.cpu + input.resources.cpu > this.capacity.cpu ||
      used.memMb + input.resources.memMb > this.capacity.memMb ||
      used.diskGb + input.resources.diskGb > this.capacity.diskGb
    ) {
      throw new CapacityExceeded();
    }
    await mkdir(input.volumePath, { recursive: true });
    await mkdir(input.commonPath, { recursive: true });
    await chown(input.volumePath, 10001, 10001);
    await chown(input.commonPath, 10001, 10001);
    const options = buildContainerCreateOptions(input);
    const container = await docker.createContainer(options);
    await container.start();
    const info = await container.inspect();
    const port = info.NetworkSettings?.Ports?.[WORKER_PORT]?.[0]?.HostPort;
    if (!port) throw new Error("worker port was not published");
    const endpoint = `http://${input.bindIp}:${port}`;
    await waitHealthy(endpoint);
    return { containerId: container.id, endpoint, volumePath: input.volumePath, options };
  }

  async start(workspaceId: string): Promise<void> {
    const row = await this.find(workspaceId);
    await (await this.docker()).getContainer(row.containerId).start().catch((err: Error) => {
      if (!/already started/i.test(err.message)) throw err;
    });
  }

  async stop(workspaceId: string): Promise<void> {
    const row = await this.find(workspaceId);
    await (await this.docker()).getContainer(row.containerId).stop({ t: 10 });
  }

  async remove(workspaceId: string, purgeVolume: boolean): Promise<void> {
    const row = await this.find(workspaceId);
    await (await this.docker()).getContainer(row.containerId).remove({ force: true });
    if (purgeVolume && row.volumePath) await rm(row.volumePath, { recursive: true, force: true });
  }

  async list(): Promise<ListedWorkspace[]> {
    const docker = await this.docker();
    const rows = await docker.listContainers({
      all: true,
      filters: { label: ["agenthub.workspace"] },
    });
    return rows.flatMap((row) => {
      const workspaceId = row.Labels?.["agenthub.workspace"];
      if (!workspaceId) return [];
      const running = row.State === "running";
      return [{ workspaceId, state: running ? "running" as const : "stopped" as const, containerId: row.Id }];
    });
  }

  async usage(): Promise<WorkspaceResources & { workspaces: number }> {
    const docker = await this.docker();
    const rows = await docker.listContainers({
      all: true,
      filters: { label: ["agenthub.workspace"] },
    });
    let cpu = 0;
    let memMb = 0;
    let diskGb = 0;
    for (const row of rows) {
      const info = await docker.getContainer(row.Id).inspect();
      const options = buildLiveUsage(info, row.State === "running");
      cpu += options.cpu;
      memMb += options.memMb;
      diskGb += options.diskGb;
    }
    return { cpu, memMb, diskGb, workspaces: rows.length };
  }

  private async find(workspaceId: string): Promise<ListedWorkspace & { volumePath: string }> {
    const row = (await this.list()).find((item) => item.workspaceId === workspaceId);
    if (!row) throw new WorkspaceNotFound(workspaceId);
    return { ...row, volumePath: "" };
  }
}

function buildLiveUsage(
  info: { HostConfig?: { NanoCpus?: number; Memory?: number }; Config?: { Labels?: Record<string, string> } },
  running: boolean,
): WorkspaceResources {
  const labels = info.Config?.Labels ?? {};
  const diskGb = Number(labels["agenthub.diskGb"] ?? 0);
  if (!running) return { cpu: 0, memMb: 0, diskGb };
  const nano = info.HostConfig?.NanoCpus ?? 0;
  const memory = info.HostConfig?.Memory ?? 0;
  return {
    cpu: nano / 1e9,
    memMb: memory / (1024 * 1024),
    diskGb,
  };
}

async function waitHealthy(endpoint: string): Promise<void> {
  let last = "not ready";
  for (let i = 0; i < 20; i += 1) {
    try {
      const res = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) return;
      last = `status ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : "unreachable";
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`worker health check failed: ${last}`);
}
