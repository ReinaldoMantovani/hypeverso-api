import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma } from './db.js';
import {
  enqueueMissingTranslations,
  processNextTranslation,
  recoverStaleTranslations,
  translationStats,
} from './services/translation.js';

/**
 * Worker de traduções (roda no SEU PC, junto com o Ollama).
 * - A cada 2 min confere artigos publicados e produtos da Shop sem tradução
 *   (ou cujo original mudou) e põe na fila.
 * - Traduz um item por vez para não disputar o Ollama com o IA Notícias.
 * Os artigos antigos também entram na fila sozinhos na primeira rodada.
 */
const PORT = Number(process.env.TRANSLATION_WORKER_HEALTH_PORT || 4060);
const SCAN_MS = Number(process.env.TRANSLATION_SCAN_MS || 120_000);

const state = {
  startedAt: new Date().toISOString(),
  lastScanAt: null as string | null,
  lastDoneAt: null as string | null,
  translated: 0,
  lastError: null as string | null,
  busy: false,
};

let stopping = false;
let lastScan = 0;

async function loop() {
  while (!stopping) {
    try {
      if (Date.now() - lastScan > SCAN_MS) {
        lastScan = Date.now();
        state.lastScanAt = new Date().toISOString();
        await recoverStaleTranslations();
        const { queued } = await enqueueMissingTranslations();
        if (queued) console.log(`[traducao] ${queued} item(ns) na fila`);
      }
      state.busy = true;
      const worked = await processNextTranslation(msg => {
        console.log(`[traducao] ${msg}`);
        if (!msg.startsWith('falhou')) {
          state.translated++;
          state.lastDoneAt = new Date().toISOString();
        }
      });
      state.busy = false;
      state.lastError = null;
      if (!worked) await sleep(15_000);
    } catch (error) {
      state.busy = false;
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error('[traducao] erro:', state.lastError);
      await sleep(30_000);
    }
  }
}

createServer(async (req, res) => {
  if (req.url === '/run' && req.method === 'POST') {
    lastScan = 0;
    res.writeHead(202, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, accepted: true }));
  }
  const stats = req.url === '/health' ? await translationStats().catch(() => []) : [];
  res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'hypeverso-translation-worker', ...state, stats }));
}).listen(PORT, '0.0.0.0', () => console.log(`[traducao] worker ativo; saúde em :${PORT}/health`));

await prisma.$connect();
void loop();

const shutdown = async () => {
  stopping = true;
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
