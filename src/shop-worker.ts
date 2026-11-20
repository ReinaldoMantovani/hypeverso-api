import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma } from './db.js';
import { applyCheckResult, productsDueForCheck } from './services/shop-check.js';
import { checkProduct } from './services/shop-scraper/check.js';

/**
 * Worker da Shop (roda no SEU PC): verifica cada produto a cada N horas
 * (Configurações › Textos da Shop › intervalo), atualiza preços, oculta
 * esgotados/links quebrados e registra o histórico de preço.
 * O acesso às lojas sai do seu PC (IP residencial: menos bloqueios).
 */
const PORT = Number(process.env.SHOP_WORKER_HEALTH_PORT || 4040);
const ROUND_MS = Number(process.env.SHOP_WORKER_ROUND_MS || 15 * 60_000);

const state = {
  startedAt: new Date().toISOString(),
  lastRoundAt: null as string | null,
  checked: 0,
  changed: 0,
  hidden: 0,
  lastError: null as string | null,
  busy: false,
};

async function round() {
  if (state.busy) return;
  state.busy = true;
  state.lastRoundAt = new Date().toISOString();
  try {
    const due = await productsDueForCheck(25);
    for (const p of due) {
      const result = await checkProduct(p);
      const updated = await applyCheckResult(p.id, result);
      state.checked++;
      if (result.status === 'PRICE_CHANGED') state.changed++;
      if (updated?.autoHidden) state.hidden++;
      console.log(`[shop] ${result.status.padEnd(13)} ${p.title.slice(0, 60)} — ${result.message}`);
      // Intervalo educado entre lojas (6–14 s): parece navegação normal e evita bloqueio.
      await sleep(6_000 + Math.random() * 8_000);
    }
    state.lastError = null;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    console.error('[shop] rodada falhou:', state.lastError);
  } finally {
    state.busy = false;
  }
}

createServer((req, res) => {
  if (req.url === '/run' && req.method === 'POST') {
    void round();
    res.writeHead(202, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, accepted: true }));
  }
  res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'hypeverso-shop-worker', ...state }));
}).listen(PORT, '0.0.0.0', () => console.log(`[shop] worker ativo; saúde em :${PORT}/health`));

await prisma.$connect();
await round();
setInterval(() => void round(), ROUND_MS);

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
