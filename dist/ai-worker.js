import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  ensureAiNewsWorkerDependencies,
  getActiveAiModel,
  processAiNewsJob,
  requestAiNewsDependencyRepair,
  startAiNewsWorker,
  stopAiNewsWorker
} from "./chunk-DLAJTYKO.js";
import "./chunk-AINQSJV5.js";
import {
  bullEnabled,
  bullPrefix,
  bullWorkerConnection,
  enqueueAiNewsJob,
  queueNames
} from "./chunk-RJRFEJ4O.js";
import "./chunk-ZIMWUEV2.js";
import {
  db_exports,
  env,
  prisma
} from "./chunk-AFZENULZ.js";

// src/ai-worker.ts
import { createServer } from "http";
import { Worker } from "bullmq";
var state = {
  startedAt: (/* @__PURE__ */ new Date()).toISOString(),
  running: false,
  busy: false,
  currentJobId: null,
  processed: 0,
  failed: 0,
  lastJobAt: null,
  lastError: null,
  dependencyState: "starting",
  dependencyMessage: "Inicializando BullMQ e depend\xEAncias da IA",
  model: getActiveAiModel()
};
var forceDependencyRepair = false;
var worker = null;
var reconcileTimer = null;
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
async function reconcilePendingJobs() {
  if (!bullEnabled()) return;
  const pending = await prisma.aiNewsJob.findMany({
    where: { status: "PENDING", hiddenAt: null, cancelRequestedAt: null },
    select: { id: true },
    take: 250,
    orderBy: { createdAt: "asc" }
  });
  for (const row of pending)
    await enqueueAiNewsJob(row.id).catch((error) => console.warn("[AI BullMQ] reconcile", row.id, errorText(error)));
}
async function claimDatabaseJob(jobId) {
  const current = await prisma.aiNewsJob.findUnique({ where: { id: jobId } });
  if (!current || current.hiddenAt || current.cancelRequestedAt || current.status === "CANCELED" || current.status === "COMPLETED")
    return false;
  if (current.status === "PROCESSING") {
    const stale = !current.lastHeartbeatAt || Date.now() - current.lastHeartbeatAt.getTime() > env.AI_NEWS_STALE_JOB_MS;
    if (!stale) return true;
  }
  const claimed = await prisma.aiNewsJob.updateMany({
    where: { id: jobId, hiddenAt: null, cancelRequestedAt: null, status: { in: ["PENDING", "FAILED", "PROCESSING"] } },
    data: {
      status: "PROCESSING",
      stage: "STARTING",
      stageMessage: "BullMQ iniciou o processamento",
      progress: Math.max(2, current.progress || 0),
      startedAt: current.startedAt ?? /* @__PURE__ */ new Date(),
      lastHeartbeatAt: /* @__PURE__ */ new Date(),
      finishedAt: null,
      error: null,
      model: getActiveAiModel(),
      attempts: { increment: 1 }
    }
  });
  return claimed.count > 0;
}
async function processQueueJob(job) {
  const dbJobId = String(job.data?.jobId || "");
  if (!dbJobId) return;
  state.busy = true;
  state.currentJobId = dbJobId;
  state.lastJobAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    state.dependencyState = "checking";
    state.dependencyMessage = "Verificando Ollama, modelo e busca";
    await ensureAiNewsWorkerDependencies(forceDependencyRepair);
    forceDependencyRepair = false;
    state.dependencyState = "ready";
    state.dependencyMessage = `IA pronta com ${getActiveAiModel()}`;
    state.model = getActiveAiModel();
    const claimed = await claimDatabaseJob(dbJobId);
    if (!claimed) return;
    await job.updateProgress(2).catch(() => void 0);
    await processAiNewsJob(dbJobId);
    const result = await prisma.aiNewsJob.findUnique({
      where: { id: dbJobId },
      select: { status: true, progress: true, error: true }
    });
    if (result) await job.updateProgress(result.progress).catch(() => void 0);
    if (result?.status === "FAILED") {
      await prisma.aiNewsJob.updateMany({
        where: { id: dbJobId, status: "FAILED", hiddenAt: null, cancelRequestedAt: null },
        data: {
          status: "PENDING",
          stage: "QUEUED",
          stageMessage: "BullMQ far\xE1 nova tentativa autom\xE1tica",
          startedAt: null,
          finishedAt: null,
          lastHeartbeatAt: null
        }
      }).catch(() => void 0);
      throw new Error(result.error || "A gera\xE7\xE3o do artigo falhou e ser\xE1 tentada novamente");
    }
    state.processed++;
    state.lastError = null;
  } catch (error) {
    const current = await prisma.aiNewsJob.findUnique({ where: { id: dbJobId }, select: { status: true, hiddenAt: true, cancelRequestedAt: true } }).catch(() => null);
    if (current?.status === "CANCELED" || current?.hiddenAt || current?.cancelRequestedAt) return;
    const message = errorText(error);
    state.lastError = message;
    state.dependencyState = /Ollama|modelo|ECONNREFUSED|fetch failed/i.test(message) ? "waiting" : "degraded";
    state.dependencyMessage = `Falha transit\xF3ria: ${message}`;
    await prisma.aiNewsJob.updateMany({
      where: { id: dbJobId, hiddenAt: null, cancelRequestedAt: null, status: "PROCESSING" },
      data: {
        status: "PENDING",
        stage: "QUEUED",
        stageMessage: "BullMQ far\xE1 nova tentativa automaticamente",
        error: message,
        startedAt: null,
        lastHeartbeatAt: null,
        finishedAt: null
      }
    }).catch(() => void 0);
    throw error;
  } finally {
    state.busy = false;
    state.currentJobId = null;
    state.lastJobAt = (/* @__PURE__ */ new Date()).toISOString();
  }
}
var healthServer = createServer(async (req, res) => {
  if (req.url === "/repair" && req.method === "POST") {
    forceDependencyRepair = true;
    requestAiNewsDependencyRepair();
    void reconcilePendingJobs();
    res.writeHead(202, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, accepted: true, state }));
    return;
  }
  if (req.url !== "/health") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  const ok = bullEnabled() ? state.running : true;
  res.writeHead(ok ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(
    JSON.stringify({
      ...state,
      ok,
      service: "nexverse-ai-worker",
      queue: bullEnabled() ? queueNames.aiNews : "legacy-db-polling",
      mode: bullEnabled() ? "bullmq-community" : "legacy",
      time: (/* @__PURE__ */ new Date()).toISOString()
    })
  );
});
healthServer.listen(env.AI_NEWS_WORKER_HEALTH_PORT, "0.0.0.0", () => {
  console.log(`[Hypeverso] AI Worker health em :${env.AI_NEWS_WORKER_HEALTH_PORT}/health`);
});
await prisma.$connect();
if (bullEnabled()) {
  worker = new Worker(queueNames.aiNews, processQueueJob, {
    connection: bullWorkerConnection,
    prefix: bullPrefix,
    concurrency: env.BULLMQ_AI_CONCURRENCY,
    lockDuration: Math.max(12e4, env.AI_NEWS_LLM_IDLE_TIMEOUT_MS + 6e4)
  });
  worker.on("ready", () => {
    state.running = true;
    state.dependencyMessage = "BullMQ conectado; aguardando jobs";
  });
  worker.on("error", (error) => {
    state.lastError = errorText(error);
    state.dependencyState = "degraded";
    state.dependencyMessage = "Falha na conex\xE3o BullMQ/Redis";
  });
  worker.on("failed", async (job, error) => {
    state.failed++;
    if (!job) return;
    const dbJobId = String(job.data?.jobId || "");
    if (!dbJobId) return;
    const attempts = Number(job.opts.attempts || 1);
    if (job.attemptsMade < attempts) return;
    await prisma.aiNewsJob.updateMany({
      where: { id: dbJobId, hiddenAt: null, cancelRequestedAt: null, status: { in: ["PENDING", "PROCESSING"] } },
      data: {
        status: "FAILED",
        stage: "FAILED",
        stageMessage: "BullMQ esgotou as tentativas autom\xE1ticas",
        error: errorText(error),
        finishedAt: /* @__PURE__ */ new Date(),
        lastHeartbeatAt: /* @__PURE__ */ new Date()
      }
    }).catch(() => void 0);
  });
  await reconcilePendingJobs();
  reconcileTimer = setInterval(() => void reconcilePendingJobs(), 3e4);
  reconcileTimer.unref?.();
  console.log(
    `[Hypeverso] AI News via BullMQ Community. Queue=${queueNames.aiNews}; concurrency=${env.BULLMQ_AI_CONCURRENCY}`
  );
} else {
  startAiNewsWorker({ unref: false });
  state.running = true;
  state.dependencyState = "ready";
  state.dependencyMessage = "Modo legado de polling PostgreSQL";
}
var shutdown = async () => {
  if (reconcileTimer) clearInterval(reconcileTimer);
  if (worker) await worker.close().catch(() => void 0);
  stopAiNewsWorker();
  await new Promise((resolve) => healthServer.close(() => resolve()));
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
//# sourceMappingURL=ai-worker.js.map