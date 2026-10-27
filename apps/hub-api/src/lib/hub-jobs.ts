import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { logger } from "./logger.js";

export const HUB_QUEUE = "hub-jobs";

export type HubJobPayload = {
  outboxId: string;
  applyJobId?: string;
  projectId?: string;
};

type Handler = (name: string, data: HubJobPayload) => Promise<void>;

let redisUrl = "";
let queueOverride: string | null = null;
let handler: Handler = async () => {};
let worker: Worker<HubJobPayload> | null = null;
let workerConn: Redis | null = null;
let inspect: Queue<HubJobPayload> | null = null;
let inspectConn: Redis | null = null;

export function bindHubJobsRedis(url: string) {
  redisUrl = url;
}

/** Tests use a private queue so a running hub-api does not take their jobs. */
export function useHubQueue(name: string) {
  if (worker) throw new Error("hub jobs already started");
  queueOverride = name;
}

function currentQueue() {
  return queueOverride ?? process.env.HUB_QUEUE_NAME ?? HUB_QUEUE;
}

export function setHubJobHandler(next: Handler) {
  handler = next;
}

function connection() {
  if (!redisUrl) throw new Error("hub jobs redis is not configured");
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  redis.on("error", (err) => {
    logger.warn({ err }, "hub-jobs redis error");
  });
  return redis;
}

async function withQueue<T>(fn: (queue: Queue<HubJobPayload>) => Promise<T>) {
  const redis = connection();
  const queue = new Queue<HubJobPayload>(currentQueue(), { connection: redis });
  try {
    return await fn(queue);
  } finally {
    await queue.close();
    redis.disconnect();
  }
}

export async function addHubJob(
  name: string,
  data: HubJobPayload,
  opts: { jobId: string; delayMs?: number },
) {
  return withQueue(async (queue) => {
    const existing = await queue.getJob(opts.jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "completed" || state === "failed" || state === "unknown") {
        await existing.remove();
      } else {
        return false;
      }
    }
    await queue.add(name, data, {
      jobId: opts.jobId,
      ...(opts.delayMs && opts.delayMs > 0 ? { delay: opts.delayMs } : {}),
      removeOnComplete: 200,
      removeOnFail: 50,
    });
    return true;
  });
}

export async function startHubJobs() {
  if (worker) return;
  workerConn = connection();
  inspectConn = connection();
  inspect = new Queue<HubJobPayload>(currentQueue(), { connection: inspectConn });
  worker = new Worker<HubJobPayload>(
    currentQueue(),
    async (job: Job<HubJobPayload>) => handler(job.name, job.data),
    { connection: workerConn, concurrency: 4 },
  );
  worker.on("error", (err) => logger.warn({ err }, "hub-jobs worker error"));
  inspect.on("error", (err) => logger.warn({ err }, "hub-jobs queue error"));
}

export async function stopHubJobs() {
  await worker?.close();
  worker = null;
  workerConn?.disconnect();
  workerConn = null;
  await inspect?.close();
  inspect = null;
  inspectConn?.disconnect();
  inspectConn = null;
}

export async function promoteDelayedHubJobs() {
  if (!inspect) throw new Error("hub jobs are not running");
  const jobs = await inspect.getJobs(["delayed"], 0, 100);
  for (const job of jobs) await job.promote();
}

export async function waitForHubDrain(timeoutMs = 8_000) {
  if (!inspect) throw new Error("hub jobs are not running");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const counts = await inspect.getJobCounts("active", "waiting");
    if ((counts.active ?? 0) + (counts.waiting ?? 0) + (counts.paused ?? 0) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("hub-jobs did not drain");
}
