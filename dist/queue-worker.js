import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  notifyNewsPublished,
  processMediaReleaseReminders,
  sendWeeklyDigest
} from "./chunk-QI3TW2B2.js";
import {
  removePostFromSearchIndex,
  syncPostToSearchIndex
} from "./chunk-YXQVW2OS.js";
import {
  bullEnabled,
  bullPrefix,
  bullWorkerConnection,
  enqueueNewsPublished,
  enqueueSearchSync,
  ensureSystemSchedules,
  queueNames,
  queueSnapshot
} from "./chunk-RJRFEJ4O.js";
import {
  delCache
} from "./chunk-ZIMWUEV2.js";
import {
  db_exports,
  env,
  prisma
} from "./chunk-AFZENULZ.js";

// src/queue-worker.ts
import { createServer } from "http";
import { Worker } from "bullmq";
var state = {
  startedAt: (/* @__PURE__ */ new Date()).toISOString(),
  running: false,
  active: 0,
  processed: 0,
  failed: 0,
  lastJob: null,
  lastJobAt: null,
  lastError: null
};
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
async function publishScheduledPosts() {
  const due = await prisma.post.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: /* @__PURE__ */ new Date() } },
    select: { id: true, publishedAt: true },
    take: 100,
    orderBy: { scheduledAt: "asc" }
  });
  let published = 0;
  for (const row of due) {
    const result = await prisma.post.updateMany({
      where: { id: row.id, status: "SCHEDULED" },
      data: { status: "PUBLISHED", publishedAt: row.publishedAt ?? /* @__PURE__ */ new Date() }
    });
    if (!result.count) continue;
    published++;
    if (!row.publishedAt) await enqueueNewsPublished(row.id).catch(() => void 0);
    await enqueueSearchSync(row.id).catch(() => void 0);
  }
  if (published) await delCache("posts:*").catch(() => void 0);
  return published;
}
async function processor(job) {
  state.active++;
  state.lastJob = job.name;
  state.lastJobAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    switch (job.name) {
      case "publish-scheduled":
        return { published: await publishScheduledPosts() };
      case "media-release-reminders":
        return { sent: await processMediaReleaseReminders() };
      case "news-published": {
        const postId = String(job.data?.postId || "");
        if (!postId) return { skipped: true };
        return { notified: await notifyNewsPublished(postId) };
      }
      case "search-sync": {
        const postId = String(job.data?.postId || "");
        if (!postId) return { skipped: true };
        await syncPostToSearchIndex(postId);
        return { synced: true };
      }
      case "search-remove": {
        const postId = String(job.data?.postId || "");
        if (!postId) return { skipped: true };
        await removePostFromSearchIndex(postId);
        return { removed: true };
      }
      case "newsletter-weekly":
        return sendWeeklyDigest({ info: console.log, warn: console.warn });
      default:
        return { ignored: true, name: job.name };
    }
  } finally {
    state.active--;
    state.processed++;
    state.lastJobAt = (/* @__PURE__ */ new Date()).toISOString();
  }
}
var worker = null;
var healthServer = createServer(async (req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  let queue = null;
  try {
    queue = bullEnabled() ? await queueSnapshot("system") : null;
  } catch (error) {
    state.lastError = errorText(error);
  }
  const ok = !bullEnabled() || state.running;
  res.writeHead(ok ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(
    JSON.stringify({
      ok,
      service: "nexverse-queue-worker",
      mode: bullEnabled() ? "bullmq-community" : "disabled",
      ...state,
      queue,
      time: (/* @__PURE__ */ new Date()).toISOString()
    })
  );
});
healthServer.listen(env.QUEUE_WORKER_HEALTH_PORT, "0.0.0.0", () => {
  console.log(`[Hypeverso] Queue Worker health em :${env.QUEUE_WORKER_HEALTH_PORT}/health`);
});
await prisma.$connect();
if (bullEnabled()) {
  await ensureSystemSchedules();
  worker = new Worker(queueNames.system, processor, {
    connection: bullWorkerConnection,
    prefix: bullPrefix,
    concurrency: env.BULLMQ_SYSTEM_CONCURRENCY
  });
  worker.on("ready", () => {
    state.running = true;
    state.lastError = null;
    console.log(`[Hypeverso] BullMQ System Worker pronto; concurrency=${env.BULLMQ_SYSTEM_CONCURRENCY}`);
  });
  worker.on("completed", () => {
    state.lastError = null;
  });
  worker.on("failed", (_job, error) => {
    state.failed++;
    state.lastError = errorText(error);
  });
  worker.on("error", (error) => {
    state.lastError = errorText(error);
  });
} else {
  state.running = true;
  console.warn("[Hypeverso] BULLMQ_ENABLED=false; queue-worker sem processamento.");
}
var shutdown = async () => {
  if (worker) await worker.close().catch(() => void 0);
  await new Promise((resolve) => healthServer.close(() => resolve()));
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
//# sourceMappingURL=queue-worker.js.map