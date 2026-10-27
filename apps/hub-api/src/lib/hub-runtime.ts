import type { Redis } from "ioredis";

export type HubRuntime = {
  platformDek: string;
  runtimeMock: boolean;
  redis: Redis;
  nodeCaDir: string;
  minAgentVersion: string;
  workerImage: string;
};
