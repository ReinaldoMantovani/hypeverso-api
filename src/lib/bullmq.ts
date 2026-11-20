import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';
import { env, redisConfigured } from '../config/env.js';
import { redisOptions } from './redis.js';

export const queueNames = {
  aiNews: 'nexverse-ai-news',
  system: 'nexverse-system',
  discovery: 'nexverse-discovery',
} as const;

export type QueueKey = keyof typeof queueNames;

function connectionOptions(worker = false) {
  // Sem Redis o BullMQ fica desligado; devolvemos opções inertes só para tipar.
  const url = new URL(env.REDIS_URL || 'redis://127.0.0.1:6379');
  const db = url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) || 0 : 0;
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db,
    maxRetriesPerRequest: worker ? null : 1,
    enableReadyCheck: true,
    // TLS (rediss://) com CA/verificação configuráveis, igual ao cliente de cache.
    ...(url.protocol === 'rediss:' ? { tls: redisOptions().tls } : {}),
  };
}

export const bullProducerConnection = connectionOptions(false);
export const bullWorkerConnection = connectionOptions(true);
export const bullPrefix = env.BULLMQ_PREFIX;
export const bullEnabled = () => redisConfigured && env.BULLMQ_ENABLED.toLowerCase() === 'true';

const queueOptions: QueueOptions = { connection: bullProducerConnection, prefix: bullPrefix };
const queues = new Map<QueueKey, Queue>();

export function getBullQueue(key: QueueKey) {
  let queue = queues.get(key);
  if (!queue) {
    queue = new Queue(queueNames[key], queueOptions);
    queues.set(key, queue);
  }
  return queue;
}

const retained: Pick<JobsOptions, 'removeOnComplete' | 'removeOnFail'> = {
  removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
  removeOnFail: { count: 2500, age: 7 * 24 * 60 * 60 },
};

export async function enqueueAiNewsJob(jobId: string) {
  if (!bullEnabled()) return null;
  const queue = getBullQueue('aiNews');
  const id = `ai-news-${jobId}`;
  const existing = await queue.getJob(id);
  if (existing) {
    const state = await existing.getState().catch(() => 'unknown');
    if (['waiting', 'active', 'delayed', 'prioritized'].includes(state)) return existing;
    await existing.remove().catch(() => undefined);
  }
  return queue.add(
    'generate',
    { jobId },
    {
      ...retained,
      jobId: id,
      attempts: env.BULLMQ_AI_NEWS_ATTEMPTS,
      backoff: { type: 'exponential', delay: env.BULLMQ_BACKOFF_MS },
    },
  );
}

export async function removeAiNewsQueueJob(jobId: string) {
  if (!bullEnabled()) return false;
  const job = await getBullQueue('aiNews').getJob(`ai-news-${jobId}`);
  if (!job) return false;
  try {
    await job.remove();
    return true;
  } catch {
    return false;
  }
}

export async function enqueueSystemJob(
  name:
    | 'publish-scheduled'
    | 'media-release-reminders'
    | 'news-published'
    | 'search-sync'
    | 'search-remove'
    | 'newsletter-weekly',
  data: Record<string, unknown> = {},
  options: JobsOptions = {},
) {
  if (!bullEnabled()) return null;
  return getBullQueue('system').add(name, data, {
    ...retained,
    attempts: 3,
    backoff: { type: 'exponential', delay: env.BULLMQ_BACKOFF_MS },
    ...options,
  });
}

export async function enqueueNewsPublished(postId: string) {
  return enqueueSystemJob('news-published', { postId }, { jobId: `news-published-${postId}` });
}

export async function enqueueSearchSync(postId: string) {
  return enqueueSystemJob('search-sync', { postId }, { jobId: `search-sync-${postId}-${Date.now()}` });
}

export async function enqueueSearchRemove(postId: string) {
  return enqueueSystemJob('search-remove', { postId }, { jobId: `search-remove-${postId}-${Date.now()}` });
}

export async function ensureSystemSchedules() {
  if (!bullEnabled()) return;
  const queue = getBullQueue('system');
  const retryOpts = {
    ...retained,
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: env.BULLMQ_BACKOFF_MS },
  };
  await queue.upsertJobScheduler(
    'schedule-publish-posts',
    { every: 60_000 },
    { name: 'publish-scheduled', data: {}, opts: retryOpts },
  );
  await queue.upsertJobScheduler(
    'schedule-media-reminders',
    { every: 15 * 60_000 },
    { name: 'media-release-reminders', data: {}, opts: retryOpts },
  );
  // Newsletter semanal (cron em UTC). A trava semanal no Redis impede envio duplicado.
  await queue.upsertJobScheduler(
    'schedule-newsletter-weekly',
    { pattern: `0 ${env.NEWSLETTER_HOUR_UTC} * * ${env.NEWSLETTER_WEEKDAY}`, tz: 'UTC' },
    { name: 'newsletter-weekly', data: {}, opts: { ...retained, attempts: 1 } },
  );
}

export async function ensureDiscoverySchedules() {
  if (!bullEnabled()) return;
  const queue = getBullQueue('discovery');
  const retryOpts = {
    ...retained,
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: env.BULLMQ_BACKOFF_MS },
  };
  await queue.upsertJobScheduler(
    'schedule-discovery-incremental',
    { every: env.DISCOVERY_POLL_MS },
    { name: 'incremental', data: {}, opts: retryOpts },
  );
  await queue.upsertJobScheduler(
    'schedule-discovery-full',
    { every: Math.max(env.DISCOVERY_POLL_MS, env.DISCOVERY_POLL_MS * env.DISCOVERY_FULL_REINDEX_EVERY) },
    { name: 'full-reindex', data: {}, opts: retryOpts },
  );
}

export async function closeBullQueues() {
  await Promise.all([...queues.values()].map(q => q.close().catch(() => undefined)));
  queues.clear();
}

export async function queueSnapshot(key: QueueKey) {
  const queue = getBullQueue(key);
  const raw = await queue.getJobCounts(
    'wait',
    'active',
    'completed',
    'failed',
    'delayed',
    'paused' as any,
    'prioritized',
  );
  const paused = await queue.isPaused();
  const counts = {
    waiting: raw.wait || 0,
    active: raw.active || 0,
    completed: raw.completed || 0,
    failed: raw.failed || 0,
    delayed: raw.delayed || 0,
    paused: raw.paused || 0,
    prioritized: raw.prioritized || 0,
  };
  return { key, name: queueNames[key], paused, counts };
}
