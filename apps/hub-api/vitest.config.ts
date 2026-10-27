import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      HUB_QUEUE_NAME: "hub-jobs-vitest",
    },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
