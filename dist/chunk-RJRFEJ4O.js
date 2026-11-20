import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  redisOptions
} from "./chunk-ZIMWUEV2.js";
import {
  env,
  redisConfigured
} from "./chunk-AFZENULZ.js";

// src/lib/bullmq.ts
import { Queue } from "bullmq";
var queueNames = {
  aiNews: "nexverse-ai-news",
  system: "nexverse-system",
  discovery: "nexverse-discovery"
};
function connectionOptions(worker = false) {
  const url = new URL(env.REDIS_URL || "redis://127.0.0.1:6379");
  const db = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) || 0 : 0;
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : void 0,
    password: url.password ? decodeURIComponent(url.password) : void 0,
    db,
    maxRetriesPerRequest: worker ? null : 1,
    enableReadyCheck: true,
    // TLS (rediss://) com CA/verificação configuráveis, igual ao cliente de cache.
    ...url.protocol === "rediss:" ? { tls: redisOptions().tls } : {}
  };
}
var bullProducerConnection = connectionOptions(false);
var bullWorkerConnection = connectionOptions(true);
var bullPrefix = env.BULLMQ_PREFIX;
var bullEnabled = () => redisConfigured && env.BULLMQ_ENABLED.toLowerCase() === "true";
var queueOptions = { connection: bullProducerConnection, prefix: bullPrefix };
var queues = /* @__PURE__ */ new Map();
function getBullQueue(key) {
  let queue = queues.get(key);
  if (!queue) {
    queue = new Queue(queueNames[key], queueOptions);
    queues.set(key, queue);
  }
  return queue;
}
var retained = {
  removeOnComplete: { count: 1e3, age: 24 * 60 * 60 },
  removeOnFail: { count: 2500, age: 7 * 24 * 60 * 60 }
};
async function enqueueAiNewsJob(jobId) {
  if (!bullEnabled()) return null;
  const queue = getBullQueue("aiNews");
  const id = `ai-news-${jobId}`;
  const existing = await queue.getJob(id);
  if (existing) {
    const state = await existing.getState().catch(() => "unknown");
    if (["waiting", "active", "delayed", "prioritized"].includes(state)) return existing;
    await existing.remove().catch(() => void 0);
  }
  return queue.add(
    "generate",
    { jobId },
    {
      ...retained,
      jobId: id,
      attempts: env.BULLMQ_AI_NEWS_ATTEMPTS,
      backoff: { type: "exponential", delay: env.BULLMQ_BACKOFF_MS }
    }
  );
}
async function removeAiNewsQueueJob(jobId) {
  if (!bullEnabled()) return false;
  const job = await getBullQueue("aiNews").getJob(`ai-news-${jobId}`);
  if (!job) return false;
  try {
    await job.remove();
    return true;
  } catch {
    return false;
  }
}
async function enqueueSystemJob(name, data = {}, options = {}) {
  if (!bullEnabled()) return null;
  return getBullQueue("system").add(name, data, {
    ...retained,
    attempts: 3,
    backoff: { type: "exponential", delay: env.BULLMQ_BACKOFF_MS },
    ...options
  });
}
async function enqueueNewsPublished(postId) {
  return enqueueSystemJob("news-published", { postId }, { jobId: `news-published-${postId}` });
}
async function enqueueSearchSync(postId) {
  return enqueueSystemJob("search-sync", { postId }, { jobId: `search-sync-${postId}-${Date.now()}` });
}
async function enqueueSearchRemove(postId) {
  return enqueueSystemJob("search-remove", { postId }, { jobId: `search-remove-${postId}-${Date.now()}` });
}
async function ensureSystemSchedules() {
  if (!bullEnabled()) return;
  const queue = getBullQueue("system");
  const retryOpts = {
    ...retained,
    attempts: 3,
    backoff: { type: "exponential", delay: env.BULLMQ_BACKOFF_MS }
  };
  await queue.upsertJobScheduler(
    "schedule-publish-posts",
    { every: 6e4 },
    { name: "publish-scheduled", data: {}, opts: retryOpts }
  );
  await queue.upsertJobScheduler(
    "schedule-media-reminders",
    { every: 15 * 6e4 },
    { name: "media-release-reminders", data: {}, opts: retryOpts }
  );
  await queue.upsertJobScheduler(
    "schedule-newsletter-weekly",
    { pattern: `0 ${env.NEWSLETTER_HOUR_UTC} * * ${env.NEWSLETTER_WEEKDAY}`, tz: "UTC" },
    { name: "newsletter-weekly", data: {}, opts: { ...retained, attempts: 1 } }
  );
}
async function ensureDiscoverySchedules() {
  if (!bullEnabled()) return;
  const queue = getBullQueue("discovery");
  const retryOpts = {
    ...retained,
    attempts: 3,
    backoff: { type: "exponential", delay: env.BULLMQ_BACKOFF_MS }
  };
  await queue.upsertJobScheduler(
    "schedule-discovery-incremental",
    { every: env.DISCOVERY_POLL_MS },
    { name: "incremental", data: {}, opts: retryOpts }
  );
  await queue.upsertJobScheduler(
    "schedule-discovery-full",
    { every: Math.max(env.DISCOVERY_POLL_MS, env.DISCOVERY_POLL_MS * env.DISCOVERY_FULL_REINDEX_EVERY) },
    { name: "full-reindex", data: {}, opts: retryOpts }
  );
}
async function queueSnapshot(key) {
  const queue = getBullQueue(key);
  const raw = await queue.getJobCounts(
    "wait",
    "active",
    "completed",
    "failed",
    "delayed",
    "paused",
    "prioritized"
  );
  const paused = await queue.isPaused();
  const counts = {
    waiting: raw.wait || 0,
    active: raw.active || 0,
    completed: raw.completed || 0,
    failed: raw.failed || 0,
    delayed: raw.delayed || 0,
    paused: raw.paused || 0,
    prioritized: raw.prioritized || 0
  };
  return { key, name: queueNames[key], paused, counts };
}

export {
  queueNames,
  bullWorkerConnection,
  bullPrefix,
  bullEnabled,
  getBullQueue,
  enqueueAiNewsJob,
  removeAiNewsQueueJob,
  enqueueNewsPublished,
  enqueueSearchSync,
  enqueueSearchRemove,
  ensureSystemSchedules,
  ensureDiscoverySchedules,
  queueSnapshot
};
//# sourceMappingURL=chunk-RJRFEJ4O.js.map