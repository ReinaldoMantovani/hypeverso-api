import { createServer } from 'node:http';
import { prisma } from './db.js';
import { moderatePendingBatch } from './services/media-moderation.js';
import { checkImageModerationHealth } from './services/image-moderation.js';

/**
 * Worker de moderação (roda no SEU PC, junto do serviço Python NudeNet).
 * A cada 30 s verifica imagens de usuários marcadas como pendentes no MySQL.
 */
const PORT = Number(process.env.MODERATION_WORKER_HEALTH_PORT || 4050);
const state = { startedAt: new Date().toISOString(), checked: 0, approved: 0, rejected: 0, lastError: null as string | null, busy: false };

async function tick() {
  if (state.busy) return;
  state.busy = true;
  try {
    const health = await checkImageModerationHealth();
    if (!health.ok) {
      state.lastError = health.message || 'moderador indisponível';
      return;
    }
    const r = await moderatePendingBatch(10);
    state.checked += r.checked;
    state.approved += r.approved;
    state.rejected += r.rejected;
    if (r.checked) console.log(`[moderação] ${r.checked} imagens: ${r.approved} aprovadas, ${r.rejected} recusadas`);
    state.lastError = null;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    state.busy = false;
  }
}

createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'hypeverso-moderation-worker', ...state }));
}).listen(PORT, '0.0.0.0', () => console.log(`[moderação] worker ativo; saúde em :${PORT}/health`));

await prisma.$connect();
await tick();
setInterval(() => void tick(), 30_000);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
