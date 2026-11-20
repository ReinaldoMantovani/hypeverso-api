import { createServer } from 'node:http';
import { Worker, type Job } from 'bullmq';
import { prisma } from './db.js';
import { env } from './config/env.js';
import {
  bullEnabled,
  bullPrefix,
  bullWorkerConnection,
  enqueueAiNewsJob,
  queueNames,
  removeAiNewsQueueJob,
} from './lib/bullmq.js';
import {
  ensureAiNewsWorkerDependencies,
  getActiveAiModel,
  processAiNewsJob,
  requestAiNewsDependencyRepair,
  startAiNewsWorker,
  stopAiNewsWorker,
} from './services/ai-news.js';

const state = {
  startedAt: new Date().toISOString(),
  running: false,
  busy: false,
  currentJobId: null as string | null,
  processed: 0,
  failed: 0,
  lastJobAt: null as string | null,
  lastError: null as string | null,
  dependencyState: 'starting',
  dependencyMessage: 'Inicializando BullMQ e dependências da IA',
  model: getActiveAiModel(),
};

let forceDependencyRepair = false;
let worker: Worker | null = null;
let reconcileTimer: NodeJS.Timeout | null = null;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function reconcilePendingJobs() {
  if (!bullEnabled()) return;
  const pending = await prisma.aiNewsJob.findMany({
    where: { status: 'PENDING', hiddenAt: null, cancelRequestedAt: null },
    select: { id: true },
    take: 250,
    orderBy: { createdAt: 'asc' },
  });
  for (const row of pending)
    await enqueueAiNewsJob(row.id).catch(error => console.warn('[AI BullMQ] reconcile', row.id, errorText(error)));
}

async function claimDatabaseJob(jobId: string) {
  const current = await prisma.aiNewsJob.findUnique({ where: { id: jobId } });
  if (
    !current ||
    current.hiddenAt ||
    current.cancelRequestedAt ||
    current.status === 'CANCELED' ||
    current.status === 'COMPLETED'
  )
    return false;
  if (current.status === 'PROCESSING') {
    const stale = !current.lastHeartbeatAt || Date.now() - current.lastHeartbeatAt.getTime() > env.AI_NEWS_STALE_JOB_MS;
    if (!stale) return true;
  }
  const claimed = await prisma.aiNewsJob.updateMany({
    where: { id: jobId, hiddenAt: null, cancelRequestedAt: null, status: { in: ['PENDING', 'FAILED', 'PROCESSING'] } },
    data: {
      status: 'PROCESSING',
      stage: 'STARTING',
      stageMessage: 'BullMQ iniciou o processamento',
      progress: Math.max(2, current.progress || 0),
      startedAt: current.startedAt ?? new Date(),
      lastHeartbeatAt: new Date(),
      finishedAt: null,
      error: null,
      model: getActiveAiModel(),
      attempts: { increment: 1 },
    },
  });
  return claimed.count > 0;
}

async function processQueueJob(job: Job<{ jobId: string }>) {
  const dbJobId = String(job.data?.jobId || '');
  if (!dbJobId) return;
  state.busy = true;
  state.currentJobId = dbJobId;
  state.lastJobAt = new Date().toISOString();
  try {
    state.dependencyState = 'checking';
    state.dependencyMessage = 'Verificando Ollama, modelo e busca';
    await ensureAiNewsWorkerDependencies(forceDependencyRepair);
    forceDependencyRepair = false;
    state.dependencyState = 'ready';
    state.dependencyMessage = `IA pronta com ${getActiveAiModel()}`;
    state.model = getActiveAiModel();

    const claimed = await claimDatabaseJob(dbJobId);
    if (!claimed) return;
    await job.updateProgress(2).catch(() => undefined);
    await processAiNewsJob(dbJobId);
    const result = await prisma.aiNewsJob.findUnique({
      where: { id: dbJobId },
      select: { status: true, progress: true, error: true },
    });
    if (result) await job.updateProgress(result.progress).catch(() => undefined);
    if (result?.status === 'FAILED') {
      await prisma.aiNewsJob
        .updateMany({
          where: { id: dbJobId, status: 'FAILED', hiddenAt: null, cancelRequestedAt: null },
          data: {
            status: 'PENDING',
            stage: 'QUEUED',
            stageMessage: 'BullMQ fará nova tentativa automática',
            startedAt: null,
            finishedAt: null,
            lastHeartbeatAt: null,
          },
        })
        .catch(() => undefined);
      throw new Error(result.error || 'A geração do artigo falhou e será tentada novamente');
    }
    state.processed++;
    state.lastError = null;
  } catch (error) {
    const current = await prisma.aiNewsJob
      .findUnique({ where: { id: dbJobId }, select: { status: true, hiddenAt: true, cancelRequestedAt: true } })
      .catch(() => null);
    if (current?.status === 'CANCELED' || current?.hiddenAt || current?.cancelRequestedAt) return;
    const message = errorText(error);
    state.lastError = message;
    state.dependencyState = /Ollama|modelo|ECONNREFUSED|fetch failed/i.test(message) ? 'waiting' : 'degraded';
    state.dependencyMessage = `Falha transitória: ${message}`;
    await prisma.aiNewsJob
      .updateMany({
        where: { id: dbJobId, hiddenAt: null, cancelRequestedAt: null, status: 'PROCESSING' },
        data: {
          status: 'PENDING',
          stage: 'QUEUED',
          stageMessage: 'BullMQ fará nova tentativa automaticamente',
          error: message,
          startedAt: null,
          lastHeartbeatAt: null,
          finishedAt: null,
        },
      })
      .catch(() => undefined);
    throw error;
  } finally {
    state.busy = false;
    state.currentJobId = null;
    state.lastJobAt = new Date().toISOString();
  }
}

const healthServer = createServer(async (req, res) => {
  if (req.url === '/repair' && req.method === 'POST') {
    forceDependencyRepair = true;
    requestAiNewsDependencyRepair();
    void reconcilePendingJobs();
    res.writeHead(202, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, accepted: true, state }));
    return;
  }
  if (req.url !== '/health') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  const ok = bullEnabled() ? state.running : true;
  res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(
    JSON.stringify({
      ...state,
      ok,
      service: 'nexverse-ai-worker',
      queue: bullEnabled() ? queueNames.aiNews : 'legacy-db-polling',
      mode: bullEnabled() ? 'bullmq-community' : 'legacy',
      time: new Date().toISOString(),
    }),
  );
});

healthServer.listen(env.AI_NEWS_WORKER_HEALTH_PORT, '0.0.0.0', () => {
  console.log(`[Hypeverso] AI Worker health em :${env.AI_NEWS_WORKER_HEALTH_PORT}/health`);
});

await prisma.$connect();

if (bullEnabled()) {
  worker = new Worker(queueNames.aiNews, processQueueJob, {
    connection: bullWorkerConnection,
    prefix: bullPrefix,
    concurrency: env.BULLMQ_AI_CONCURRENCY,
    lockDuration: Math.max(120_000, env.AI_NEWS_LLM_IDLE_TIMEOUT_MS + 60_000),
  });
  worker.on('ready', () => {
    state.running = true;
    state.dependencyMessage = 'BullMQ conectado; aguardando jobs';
  });
  worker.on('error', error => {
    state.lastError = errorText(error);
    state.dependencyState = 'degraded';
    state.dependencyMessage = 'Falha na conexão BullMQ/Redis';
  });
  worker.on('failed', async (job, error) => {
    state.failed++;
    if (!job) return;
    const dbJobId = String((job.data as any)?.jobId || '');
    if (!dbJobId) return;
    const attempts = Number(job.opts.attempts || 1);
    if (job.attemptsMade < attempts) return;
    await prisma.aiNewsJob
      .updateMany({
        where: { id: dbJobId, hiddenAt: null, cancelRequestedAt: null, status: { in: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'FAILED',
          stage: 'FAILED',
          stageMessage: 'BullMQ esgotou as tentativas automáticas',
          error: errorText(error),
          finishedAt: new Date(),
          lastHeartbeatAt: new Date(),
        },
      })
      .catch(() => undefined);
  });
  await reconcilePendingJobs();
  reconcileTimer = setInterval(() => void reconcilePendingJobs(), 30_000);
  reconcileTimer.unref?.();
  console.log(
    `[Hypeverso] AI News via BullMQ Community. Queue=${queueNames.aiNews}; concurrency=${env.BULLMQ_AI_CONCURRENCY}`,
  );
} else {
  startAiNewsWorker({ unref: false });
  state.running = true;
  state.dependencyState = 'ready';
  state.dependencyMessage = 'Modo legado de polling PostgreSQL';
}

const shutdown = async () => {
  if (reconcileTimer) clearInterval(reconcileTimer);
  if (worker) await worker.close().catch(() => undefined);
  stopAiNewsWorker();
  await new Promise<void>(resolve => healthServer.close(() => resolve()));
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
