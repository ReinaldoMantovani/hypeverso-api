import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  embeddingModelStatus,
  ensureEmbeddingModel,
  ensureVectorInfrastructure,
  syncPostEmbeddings
} from "./chunk-GCV4ST27.js";
import {
  rebuildSearchIndex,
  searchIndexHealth
} from "./chunk-YXQVW2OS.js";
import {
  bullEnabled,
  bullPrefix,
  bullWorkerConnection,
  ensureDiscoverySchedules,
  queueNames,
  queueSnapshot
} from "./chunk-RJRFEJ4O.js";
import "./chunk-ZIMWUEV2.js";
import {
  db_exports,
  env,
  meiliConfigured,
  prisma
} from "./chunk-AFZENULZ.js";

// src/discovery-worker.ts
import { createServer } from "http";
import { Worker } from "bullmq";
var state = {
  startedAt: (/* @__PURE__ */ new Date()).toISOString(),
  lastRunAt: null,
  lastSearchSyncAt: null,
  lastEmbeddingSyncAt: null,
  searchDocuments: 0,
  embeddingsProcessed: 0,
  searchOk: false,
  embeddingOk: false,
  lastError: null,
  running: false,
  active: 0
};
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
async function runCycle(fullSearchSync) {
  state.active++;
  state.lastRunAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    if (fullSearchSync && meiliConfigured) {
      try {
        const result2 = await rebuildSearchIndex();
        state.searchDocuments = result2.indexed;
        state.lastSearchSyncAt = (/* @__PURE__ */ new Date()).toISOString();
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
      state.searchOk = true;
    }
    await ensureEmbeddingModel();
    await ensureVectorInfrastructure();
    const result = await syncPostEmbeddings();
    state.embeddingsProcessed += result.indexed;
    state.lastEmbeddingSyncAt = (/* @__PURE__ */ new Date()).toISOString();
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
var worker = null;
var legacyTimer = null;
var legacyCycle = 0;
var healthServer = createServer(async (req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  const [search, model, queue] = await Promise.all([
    searchIndexHealth().catch((error) => ({ ok: false, error: errorText(error) })),
    embeddingModelStatus().catch((error) => ({ ok: false, installed: false, error: errorText(error) })),
    bullEnabled() ? queueSnapshot("discovery").catch(() => null) : Promise.resolve(null)
  ]);
  const ok = state.running && Boolean(search.ok) && Boolean(model.ok) && Boolean(model.installed);
  const payload = {
    service: "nexverse-discovery-worker",
    status: ok ? "ok" : "degraded",
    ok,
    ...state,
    search,
    embeddingModel: model,
    queue,
    mode: bullEnabled() ? "bullmq-community" : "legacy",
    time: (/* @__PURE__ */ new Date()).toISOString()
  };
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
});
healthServer.listen(env.DISCOVERY_WORKER_HEALTH_PORT, "0.0.0.0", () => {
  console.log(`[Hypeverso] Discovery Worker health em :${env.DISCOVERY_WORKER_HEALTH_PORT}/health`);
});
await prisma.$connect();
await ensureVectorInfrastructure().catch((error) => console.warn("[Discovery] pgvector ainda n\xE3o pronto", error));
if (bullEnabled()) {
  await ensureDiscoverySchedules();
  worker = new Worker(queueNames.discovery, async (job) => runCycle(job.name === "full-reindex"), {
    connection: bullWorkerConnection,
    prefix: bullPrefix,
    concurrency: env.BULLMQ_DISCOVERY_CONCURRENCY
  });
  worker.on("ready", () => {
    state.running = true;
    console.log(`[Hypeverso] Discovery via BullMQ Community; concurrency=${env.BULLMQ_DISCOVERY_CONCURRENCY}`);
  });
  worker.on("failed", (_job, error) => {
    state.lastError = errorText(error);
  });
  worker.on("error", (error) => {
    state.lastError = errorText(error);
  });
} else {
  state.running = true;
  await runCycle(true).catch(() => void 0);
  legacyTimer = setInterval(() => {
    legacyCycle++;
    void runCycle(legacyCycle % Math.max(1, env.DISCOVERY_FULL_REINDEX_EVERY) === 0).catch(() => void 0);
  }, env.DISCOVERY_POLL_MS);
}
var shutdown = async () => {
  if (legacyTimer) clearInterval(legacyTimer);
  if (worker) await worker.close().catch(() => void 0);
  await new Promise((resolve) => healthServer.close(() => resolve()));
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
//# sourceMappingURL=discovery-worker.js.map