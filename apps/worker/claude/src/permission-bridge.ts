import { randomUUID } from "node:crypto";
import type { EventBus } from "@agenthub/worker-common";
import { createBusEvent } from "@agenthub/worker-common";
import type { ClaudePermissionRule } from "@agenthub/runtime-contract";

export type PermissionDecision = "allow" | "deny" | "always" | "timeout";

export type ToolDecision = {
  behavior: "allow" | "deny";
  updatedInput?: unknown;
};

export type Scheduler = (ms: number, fn: () => void) => () => void;

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * canUseTool bridge. allow/deny return immediately.
 * ask publishes permission_request and waits for the owner, or times out as deny.
 */
export class PermissionBridge {
  private pending = new Map<
    string,
    { sessionRef: string; cancel: () => void; resolve: (decision: PermissionDecision) => void }
  >();

  constructor(
    private bus: EventBus,
    private opts: {
      rules: () => Record<string, ClaudePermissionRule>;
      timeoutMs?: number;
      schedule?: Scheduler;
    },
  ) {}

  async canUseTool(sessionRef: string, tool: string, input: unknown): Promise<ToolDecision> {
    const rule = this.opts.rules()[tool] ?? "ask";
    if (rule === "allow") return { behavior: "allow", updatedInput: input };
    if (rule === "deny") return { behavior: "deny" };

    const reqId = randomUUID();
    this.bus.publish(
      createBusEvent(sessionRef, "permission_request", {
        reqId,
        tool,
        input,
        options: ["allow", "deny", "always"],
      }),
    );

    const decision = await new Promise<PermissionDecision>((resolve) => {
      const cancel = (this.opts.schedule ?? defaultSchedule)(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
        this.finish(reqId, "timeout");
      });
      this.pending.set(reqId, { sessionRef, cancel, resolve });
    });

    const behavior = decision === "deny" || decision === "timeout" ? "deny" : "allow";
    return behavior === "allow" ? { behavior, updatedInput: input } : { behavior: "deny" };
  }

  resolve(sessionRef: string, reqId: string, decision: "allow" | "deny" | "always") {
    const pending = this.pending.get(reqId);
    if (!pending || pending.sessionRef !== sessionRef) return false;
    this.finish(reqId, decision);
    return true;
  }

  private finish(reqId: string, decision: PermissionDecision) {
    const pending = this.pending.get(reqId);
    if (!pending) return;
    this.pending.delete(reqId);
    pending.cancel();
    this.bus.publish(
      createBusEvent(pending.sessionRef, "permission_resolved", {
        reqId,
        decision,
      }),
    );
    pending.resolve(decision);
  }
}

function defaultSchedule(ms: number, fn: () => void): () => void {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
}
