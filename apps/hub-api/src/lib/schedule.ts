export type Resources = {
  cpu: number;
  memMb: number;
  diskGb: number;
  workspaces: number;
};

export type NodeCapacity = Resources & { maxWorkspaces: number };

export type SchedNode = {
  id: string;
  status: string;
  labels: Record<string, string>;
  lastHeartbeatAtMs: number | null;
  agentHealth: "ok" | "degraded";
  capacity: NodeCapacity;
  used: Resources;
};

export function asResources(value: unknown): Resources {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    cpu: typeof record.cpu === "number" ? record.cpu : 0,
    memMb: typeof record.memMb === "number" ? record.memMb : 0,
    diskGb: typeof record.diskGb === "number" ? record.diskGb : 0,
    workspaces: typeof record.workspaces === "number" ? record.workspaces : 0,
  };
}

export function asCapacity(value: unknown): NodeCapacity {
  const resources = asResources(value);
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ...resources,
    maxWorkspaces:
      typeof record.maxWorkspaces === "number" ? record.maxWorkspaces : resources.workspaces,
  };
}

export function asLabels(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const labels: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") labels[key] = item;
  }
  return labels;
}

export function semverLt(left: string, right: string): boolean {
  const a = left.split(".").map((part) => Number(part) || 0);
  const b = right.split(".").map((part) => Number(part) || 0);
  for (let i = 0; i < 3; i += 1) {
    const da = a[i] ?? 0;
    const db = b[i] ?? 0;
    if (da < db) return true;
    if (da > db) return false;
  }
  return false;
}

function freeRatio(capacity: number, used: number): number {
  if (capacity <= 0) return 0;
  return Math.max(0, Math.min(1, (capacity - used) / capacity));
}

/** 0.5 cpu free + 0.3 mem free + 0.2 workspace-slot free. */
export function nodeScore(node: SchedNode): number {
  return (
    0.5 * freeRatio(node.capacity.cpu, node.used.cpu) +
    0.3 * freeRatio(node.capacity.memMb, node.used.memMb) +
    0.2 * freeRatio(node.capacity.maxWorkspaces, node.used.workspaces)
  );
}

function fits(node: SchedNode, spec: { cpu: number; memMb: number; diskGb: number }): boolean {
  return (
    node.capacity.cpu - node.used.cpu >= spec.cpu &&
    node.capacity.memMb - node.used.memMb >= spec.memMb &&
    node.capacity.diskGb - node.used.diskGb >= spec.diskGb &&
    node.capacity.maxWorkspaces - node.used.workspaces >= 1
  );
}

function labelsMatch(labels: Record<string, string>, selector: Record<string, string>): boolean {
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

export function rankNodes<T extends SchedNode>(
  nodes: T[],
  spec: { cpu: number; memMb: number; diskGb: number },
  opts: {
    now: number;
    selector?: Record<string, string>;
    stickyNodeId?: string | null;
    heartbeatMaxAgeMs?: number;
  },
): T[] {
  const maxAge = opts.heartbeatMaxAgeMs ?? 60_000;
  const selector = opts.selector ?? {};
  const eligible = nodes.filter((node) => {
    if (node.status !== "active") return false;
    if (node.agentHealth === "degraded") return false;
    if (node.lastHeartbeatAtMs == null || opts.now - node.lastHeartbeatAtMs > maxAge) return false;
    if (!labelsMatch(node.labels, selector)) return false;
    return fits(node, spec);
  });
  if (opts.stickyNodeId) {
    const sticky = eligible.find((node) => node.id === opts.stickyNodeId);
    if (sticky) return [sticky];
  }
  return [...eligible].sort((a, b) => {
    const delta = nodeScore(b) - nodeScore(a);
    if (delta !== 0) return delta;
    return a.id < b.id ? -1 : 1;
  });
}

export function workspaceSpecOf(settings: unknown): { cpu: number; memMb: number; diskGb: number } {
  const record = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const spec =
    record.workspaceSpec && typeof record.workspaceSpec === "object"
      ? (record.workspaceSpec as Record<string, unknown>)
      : {};
  return {
    cpu: typeof spec.cpu === "number" ? spec.cpu : 2,
    memMb: typeof spec.memMb === "number" ? spec.memMb : 4096,
    diskGb: typeof spec.diskGb === "number" ? spec.diskGb : 20,
  };
}

export function wantsManagedDelivery(
  settings: unknown,
  bindings: Array<{ instanceId: string | null; labelSelector: unknown }>,
): { managed: boolean; selector: Record<string, string> } {
  const record = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const delivery = record.runtimeDelivery;
  const labelBinding = bindings.find((binding) => !binding.instanceId && binding.labelSelector);
  const selector = asLabels(labelBinding?.labelSelector);
  if (delivery === "external") return { managed: false, selector: {} };
  if (delivery === "managed" || labelBinding) return { managed: true, selector };
  return { managed: false, selector: {} };
}
