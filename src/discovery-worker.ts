import { createServer } from 'node:http';
import { Worker, type Job } from 'bullmq';
import { prisma } from './db.js';
import { env, meiliConfigured } from './config/env.js';
import {
  bullEnabled,
  bullPrefix,
  bullWorkerConnection,
  ensureDiscoverySchedules,
  queueNames,
  queueSnapshot,
} from './lib/bullmq.js';
import {
  ensureEmbeddingModel,
  ensureVectorInfrastructure,
  embeddingModelStatus,
  syncPostEmbeddings,
} from './services/embeddings.js';
import { rebuildSearchIndex, searchIndexHealth } from './services/search-index.js';

const state = {
  startedAt: new Date().toISOString(),
  lastRunAt: null as string | null,
  lastSearchSyncAt: null as string | null,
  lastEmbeddingSyncAt: null as string | null,
  searchDocuments: 0,
  embeddingsProcessed: 0,
  searchOk: false,
  embeddingOk: false,
  lastError: null as string | null,
  running: false,
  active: 0,
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function runCycle(fullSearchSync: boolean) {
  state.active++;
  state.lastRunAt = new Date().toISOString();
  try {
    if (fullSearchSync && meiliConfigured) {
      try {
        const result = await rebuildSearchIndex();
        state.searchDocuments = result.indexed;
        state.lastSearchSyncAt = new Date().toISOString();
        state.searchOk = true;
      } catch (error) {
        state.searchOk = false;
        state.lastError = `Busca: ${errorText(error)}`;
        throw error;
      }
    } else if (meiliConfigured) {
      const search = await searchIndexHealth();
      state.searchOk = search.ok;
    } else {
      // Sem Meilisearch a busca do site usa o MySQL; aqui só geramos os embeddings.
      state.searchOk = true;
    }

    await ensureEmbeddingModel();
    await ensureVectorInfrastructure();
    const result = await syncPostEmbeddings();
    state.embeddingsProcessed += result.indexed;
    state.lastEmbeddingSyncAt = new Date().toISOString();
    state.embeddingOk = true;
    if (state.searchOk) state.lastError = null;
    return { fullSearchSync, embeddings: result.indexed, searchDocuments: state.searchDocuments };
  } catch (error) {
    state.embeddingOk = false;
    state.lastError = state.lastError || `Discovery: ${errorText(error)}`;
    throw error;
  } finally {
    state.active--;
  }
}

let worker: Worker | null = null;
let legacyTimer: NodeJS.Timeout | null = null;
let legacyCycle = 0;

const healthServer = createServer(async (req, res) => {
  if (req.url !== '/health') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  const [search, model, queue] = await Promise.all([
    searchIndexHealth().catch(error => ({ ok: false, error: errorText(error) })),
    embeddingModelStatus().catch(error => ({ ok: false, installed: false, error: errorText(error) })),
    bullEnabled() ? queueSnapshot('discovery').catch(() => null) : Promise.resolve(null),
  ]);
  const ok = state.running && Boolean(search.ok) && Boolean((model as any).ok) && Boolean((model as any).installed);
  const payload = {
    service: 'nexverse-discovery-worker',
    status: ok ? 'ok' : 'degraded',
    ok,
    ...state,
    search,
    embeddingModel: model,
    queue,
    mode: bullEnabled() ? 'bullmq-community' : 'legacy',
    time: new Date().toISOString(),
  };
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
});

healthServer.listen(env.DISCOVERY_WORKER_HEALTH_PORT, '0.0.0.0', () => {
  console.log(`[Hypeverso] Discovery Worker health em :${env.DISCOVERY_WORKER_HEALTH_PORT}/health`);
});

await prisma.$connect();
await ensureVectorInfrastructure().catch(error => console.warn('[Discovery] pgvector ainda não pronto', error));

if (bullEnabled()) {
  await ensureDiscoverySchedules();
  worker = new Worker(queueNames.discovery, async (job: Job) => runCycle(job.name === 'full-reindex'), {
    connection: bullWorkerConnection,
    prefix: bullPrefix,
    concurrency: env.BULLMQ_DISCOVERY_CONCURRENCY,
  });
  worker.on('ready', () => {
    state.running = true;
    console.log(`[Hypeverso] Discovery via BullMQ Community; concurrency=${env.BULLMQ_DISCOVERY_CONCURRENCY}`);
  });
  worker.on('failed', (_job, error) => {
    state.lastError = errorText(error);
  });
  worker.on('error', error => {
    state.lastError = errorText(error);
  });
} else {
  state.running = true;
  await runCycle(true).catch(() => undefined);
  legacyTimer = setInterval(() => {
    legacyCycle++;
    void runCycle(legacyCycle % Math.max(1, env.DISCOVERY_FULL_REINDEX_EVERY) === 0).catch(() => undefined);
  }, env.DISCOVERY_POLL_MS);
}

const shutdown = async () => {
  if (legacyTimer) clearInterval(legacyTimer);
  if (worker) await worker.close().catch(() => undefined);
  await new Promise<void>(resolve => healthServer.close(() => resolve()));
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
