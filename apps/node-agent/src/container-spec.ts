export type WorkspaceResources = {
  cpu: number;
  memMb: number;
  diskGb: number;
};

export const WORKER_PORT = "4096/tcp";
export const WORKER_UID = "10001:10001";
export const WORKER_NETWORK = "agenthub-ws";

const IMAGE_RE =
  /^agenthub\/worker-(opencode|claude)((:[A-Za-z0-9._-]+)|(@sha256:[a-f0-9]{64}))?$/;

export type ContainerCreateInput = {
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

export type ContainerCreateOptions = {
  name: string;
  Image: string;
  User: string;
  Env: string[];
  Labels: Record<string, string>;
  ExposedPorts: Record<string, object>;
  HostConfig: {
    CapDrop: string[];
    SecurityOpt: string[];
    Privileged: false;
    ReadonlyRootfs: false;
    NetworkMode: string;
    Binds: string[];
    PortBindings: Record<string, Array<{ HostIp: string; HostPort: string }>>;
    NanoCpus: number;
    Memory: number;
    MemorySwap: number;
    PidsLimit: number;
    Tmpfs: Record<string, string>;
  };
};

/** Docker create options for one managed workspace. Never mounts docker.sock. */
export function buildContainerCreateOptions(input: ContainerCreateInput): ContainerCreateOptions {
  if (!IMAGE_RE.test(input.image)) {
    throw new Error(`refusing image ${input.image}; expected agenthub/worker-opencode or agenthub/worker-claude`);
  }
  const binds = [`${input.volumePath}:/workspace`, `${input.commonPath}:/project-common:ro`];
  for (const bind of binds) {
    if (bind.includes("docker.sock")) {
      throw new Error("refusing to mount docker.sock");
    }
  }
  const memory = Math.round(input.resources.memMb * 1024 * 1024);
  return {
    name: `agenthub-${input.workspaceId}`,
    Image: input.image,
    User: WORKER_UID,
    Env: [
      `WORKSPACE_ID=${input.workspaceId}`,
      `TENANT_ID=${input.tenantId}`,
      `PROJECT_ID=${input.projectId}`,
      `USER_ID=${input.userId}`,
      `BOOT_TOKEN=${input.bootToken}`,
    ],
    Labels: {
      "agenthub.tenant": input.tenantId,
      "agenthub.project": input.projectId,
      "agenthub.user": input.userId,
      "agenthub.workspace": input.workspaceId,
      "agenthub.diskGb": String(input.resources.diskGb),
    },
    ExposedPorts: { [WORKER_PORT]: {} },
    HostConfig: {
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Privileged: false,
      ReadonlyRootfs: false,
      NetworkMode: WORKER_NETWORK,
      Binds: binds,
      PortBindings: {
        [WORKER_PORT]: [{ HostIp: input.bindIp, HostPort: "" }],
      },
      NanoCpus: Math.round(input.resources.cpu * 1e9),
      Memory: memory,
      MemorySwap: memory,
      PidsLimit: 1024,
      Tmpfs: { "/run/agenthub": "rw,noexec,nosuid,size=64m" },
    },
  };
}
