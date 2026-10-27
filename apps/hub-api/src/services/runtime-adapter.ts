import { claudeAdapter } from "@agenthub/adapter-claude";
import { opencodeAdapter } from "@agenthub/adapter-opencode";
import type { RuntimeType } from "@agenthub/runtime-contract";

export function adapterFor(runtimeType: RuntimeType | string) {
  return runtimeType === "claude" ? claudeAdapter : opencodeAdapter;
}
