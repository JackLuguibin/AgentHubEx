import type { Redis } from "ioredis";

export type HubRuntime = {
  platformDek: string;
  runtimeMock: boolean;
  redis: Redis;
  nodeCaDir: string;
  minAgentVersion: string;
  workerImages: { opencode: string; claude: string };
  /** Runtime base URL for LLM calls. The provider key stays on the Hub. */
  publicBaseUrl: string;
  llmProxySecret: string;
};
