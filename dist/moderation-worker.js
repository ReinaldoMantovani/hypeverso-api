import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  checkImageModerationHealth,
  moderatePendingBatch
} from "./chunk-F76J3522.js";
import "./chunk-AINQSJV5.js";
import {
  db_exports,
  prisma
} from "./chunk-AFZENULZ.js";

// src/moderation-worker.ts
import { createServer } from "http";
var PORT = Number(process.env.MODERATION_WORKER_HEALTH_PORT || 4050);
var state = { startedAt: (/* @__PURE__ */ new Date()).toISOString(), checked: 0, approved: 0, rejected: 0, lastError: null, busy: false };
async function tick() {
  if (state.busy) return;
  state.busy = true;
  try {
    const health = await checkImageModerationHealth();
    if (!health.ok) {
      state.lastError = health.message || "moderador indispon\xEDvel";
      return;
    }
    const r = await moderatePendingBatch(10);
    state.checked += r.checked;
    state.approved += r.approved;
    state.rejected += r.rejected;
    if (r.checked) console.log(`[modera\xE7\xE3o] ${r.checked} imagens: ${r.approved} aprovadas, ${r.rejected} recusadas`);
    state.lastError = null;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    state.busy = false;
  }
}
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "hypeverso-moderation-worker", ...state }));
}).listen(PORT, "0.0.0.0", () => console.log(`[modera\xE7\xE3o] worker ativo; sa\xFAde em :${PORT}/health`));
await prisma.$connect();
await tick();
setInterval(() => void tick(), 3e4);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
//# sourceMappingURL=moderation-worker.js.map