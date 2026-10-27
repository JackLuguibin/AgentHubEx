import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  buildContainerCreateOptions,
  type ContainerCreateOptions,
  type WorkspaceResources,
} from "./container-spec.js";

export type { WorkspaceResources };

export type Capacity = WorkspaceResources & { maxWorkspaces: number };

export type CreateWorkspaceInput = {
  workspaceId: string;
  tenantId: string;
  projectId: string;
  userId: string;
  image: string;
  resources: WorkspaceResources;
  bootToken: string;
  volumePath: string;
  commonPath: string;
  bindIp: string;
};

export type CreatedWorkspace = {
  containerId: string;
  endpoint: string;
  volumePath: string;
  options: ContainerCreateOptions;
};

export type ListedWorkspace = {
  workspaceId: string;
  state: "running" | "stopped";
  containerId: string;
};

export interface DockerControl {
  readonly kind: "fake" | "dockerode";
  ensureNetwork(): Promise<void>;
  createWorkspace(input: CreateWorkspaceInput): Promise<CreatedWorkspace>;
  start(workspaceId: string): Promise<void>;
  stop(workspaceId: string): Promise<void>;
  remove(workspaceId: string, purgeVolume: boolean): Promise<void>;
  list(): Promise<ListedWorkspace[]>;
  usage(): Promise<WorkspaceResources & { workspaces: number }>;
}

type FakeRecord = CreatedWorkspace & {
  state: "running" | "stopped";
  resources: WorkspaceResources;
  commonPath: string;
};

export class CapacityExceeded extends Error {
  constructor(message = "node capacity exceeded") {
    super(message);
    this.name = "CapacityExceeded";
  }
}

export class WorkspaceNotFound extends Error {
  constructor(id: string) {
    super(`workspace ${id} not found`);
    this.name = "WorkspaceNotFound";
  }
}

/** In-process Docker stand-in. Endpoint is mock:// so Hub can open a session without the worker image. */
export class FakeDocker implements DockerControl {
  readonly kind = "fake" as const;
  private readonly records = new Map<string, FakeRecord>();

  constructor(private readonly capacity: Capacity) {}

  async ensureNetwork(): Promise<void> {}

  async createWorkspace(input: CreateWorkspaceInput): Promise<CreatedWorkspace> {
    const existing = this.records.get(input.workspaceId);
    if (existing) {
      existing.state = "running";
      return existing;
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
    const options = buildContainerCreateOptions(input);
    const created: FakeRecord = {
      containerId: `fake-${input.workspaceId}`,
      endpoint: `mock://managed/${input.workspaceId}`,
      volumePath: input.volumePath,
      options,
      state: "running",
      resources: input.resources,
      commonPath: input.commonPath,
    };
    this.records.set(input.workspaceId, created);
    return created;
  }

  async start(workspaceId: string): Promise<void> {
    const row = this.must(workspaceId);
    row.state = "running";
  }

  async stop(workspaceId: string): Promise<void> {
    const row = this.must(workspaceId);
    row.state = "stopped";
  }

  async remove(workspaceId: string, purgeVolume: boolean): Promise<void> {
    const row = this.must(workspaceId);
    this.records.delete(workspaceId);
    if (purgeVolume) await rm(row.volumePath, { recursive: true, force: true });
  }

  async list(): Promise<ListedWorkspace[]> {
    return [...this.records.entries()].map(([workspaceId, row]) => ({
      workspaceId,
      state: row.state,
      containerId: row.containerId,
    }));
  }

  async usage(): Promise<WorkspaceResources & { workspaces: number }> {
    let cpu = 0;
    let memMb = 0;
    let diskGb = 0;
    for (const row of this.records.values()) {
      diskGb += row.resources.diskGb;
      if (row.state === "running") {
        cpu += row.resources.cpu;
        memMb += row.resources.memMb;
      }
    }
    return { cpu, memMb, diskGb, workspaces: this.records.size };
  }

  inspect(workspaceId: string): FakeRecord | undefined {
    return this.records.get(workspaceId);
  }

  private must(workspaceId: string): FakeRecord {
    const row = this.records.get(workspaceId);
    if (!row) throw new WorkspaceNotFound(workspaceId);
    return row;
  }
}

export function volumePathFor(root: string, tenantId: string, projectId: string, userId: string, workspaceId: string) {
  return path.join(root, tenantId, projectId, userId, workspaceId);
}

export function commonPathFor(root: string, tenantId: string, projectId: string) {
  return path.join(root, tenantId, projectId);
}
