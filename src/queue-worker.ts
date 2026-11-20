import { createServer } from 'node:http';
import { Worker, type Job } from 'bullmq';
import { prisma } from './db.js';
import { env } from './config/env.js';
import {
  bullEnabled,
  bullPrefix,
  bullWorkerConnection,
  ensureSystemSchedules,
  enqueueNewsPublished,
  enqueueSearchSync,
  queueNames,
  queueSnapshot,
} from './lib/bullmq.js';
import { notifyNewsPublished, processMediaReleaseReminders } from './services/notifications.js';
import { removePostFromSearchIndex, syncPostToSearchIndex } from './services/search-index.js';
import { delCache } from './lib/redis.js';
import { sendWeeklyDigest } from './services/newsletter.js';

const state = {
  startedAt: new Date().toISOString(),
  running: false,
  active: 0,
  processed: 0,
  failed: 0,
  lastJob: null as string | null,
  lastJobAt: null as string | null,
  lastError: null as string | null,
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function publishScheduledPosts() {
  const due = await prisma.post.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
    select: { id: true, publishedAt: true },
    take: 100,
    orderBy: { scheduledAt: 'asc' },
  });
  let published = 0;
  for (const row of due) {
    const result = await prisma.post.updateMany({
      where: { id: row.id, status: 'SCHEDULED' },
      data: { status: 'PUBLISHED', publishedAt: row.publishedAt ?? new Date() },
    });
    if (!result.count) continue;
    published++;
    if (!row.publishedAt) await enqueueNewsPublished(row.id).catch(() => undefined);
    await enqueueSearchSync(row.id).catch(() => undefined);
  }
  if (published) await delCache('posts:*').catch(() => undefined);
  return published;
}

async function processor(job: Job) {
  state.active++;
  state.lastJob = job.name;
  state.lastJobAt = new Date().toISOString();
  try {
    switch (job.name) {
      case 'publish-scheduled':
        return { published: await publishScheduledPosts() };
      case 'media-release-reminders':
        return { sent: await processMediaReleaseReminders() };
      case 'news-published': {
        const postId = String((job.data as any)?.postId || '');
        if (!postId) return { skipped: true };
        return { notified: await notifyNewsPublished(postId) };
      }
      case 'search-sync': {
        const postId = String((job.data as any)?.postId || '');
        if (!postId) return { skipped: true };
        await syncPostToSearchIndex(postId);
        return { synced: true };
      }
      case 'search-remove': {
        const postId = String((job.data as any)?.postId || '');
        if (!postId) return { skipped: true };
        await removePostFromSearchIndex(postId);
        return { removed: true };
      }
      case 'newsletter-weekly':
        return sendWeeklyDigest({ info: console.log, warn: console.warn });
      default:
        return { ignored: true, name: job.name };
    }
  } finally {
    state.active--;
    state.processed++;
    state.lastJobAt = new Date().toISOString();
  }
}

let worker: Worker | null = null;

const healthServer = createServer(async (req, res) => {
  if (req.url !== '/health') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  let queue: any = null;
  try {
    queue = bullEnabled() ? await queueSnapshot('system') : null;
  } catch (error) {
    state.lastError = errorText(error);
  }
  const ok = !bullEnabled() || state.running;
  res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(
    JSON.stringify({
      ok,
      service: 'nexverse-queue-worker',
      mode: bullEnabled() ? 'bullmq-community' : 'disabled',
      ...state,
      queue,
      time: new Date().toISOString(),
    }),
  );
});

healthServer.listen(env.QUEUE_WORKER_HEALTH_PORT, '0.0.0.0', () => {
  console.log(`[Hypeverso] Queue Worker health em :${env.QUEUE_WORKER_HEALTH_PORT}/health`);
});

await prisma.$connect();
if (bullEnabled()) {
  await ensureSystemSchedules();
  worker = new Worker(queueNames.system, processor, {
    connection: bullWorkerConnection,
    prefix: bullPrefix,
    concurrency: env.BULLMQ_SYSTEM_CONCURRENCY,
  });
  worker.on('ready', () => {
    state.running = true;
    state.lastError = null;
    console.log(`[Hypeverso] BullMQ System Worker pronto; concurrency=${env.BULLMQ_SYSTEM_CONCURRENCY}`);
  });
  worker.on('completed', () => {
    state.lastError = null;
  });
  worker.on('failed', (_job, error) => {
    state.failed++;
    state.lastError = errorText(error);
  });
  worker.on('error', error => {
    state.lastError = errorText(error);
  });
} else {
  state.running = true;
  console.warn('[Hypeverso] BULLMQ_ENABLED=false; queue-worker sem processamento.');
}

const shutdown = async () => {
  if (worker) await worker.close().catch(() => undefined);
  await new Promise<void>(resolve => healthServer.close(() => resolve()));
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
