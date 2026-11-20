// Roda a IA do Hypeverso no seu PC SEM Docker (Ollama instalado no Windows/Mac/Linux).
//   1. Instale o Ollama: https://ollama.com/download
//   2. cp .env.worker.example .env.worker  e preencha DATABASE_URL (MySQL da Hostinger)
//   3. npm install && npm run worker:local
// Sobe IA Notícias, recomendações e a verificação da Shop (e a moderação com MODERATION=on); reinicia se caírem.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const file = process.argv[2] || '.env.worker';
const env = { ...process.env };
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} else {
  console.warn(`[workers] ${file} não encontrado; usando só as variáveis do sistema.`);
}
// Padrões para rodar fora do Docker.
env.NODE_ENV ||= 'staging';
env.OLLAMA_URL ||= 'http://127.0.0.1:11434';
env.SEARXNG_URL ||= 'http://127.0.0.1:8080';
env.ARTICLE_EXTRACTOR_URL ||= 'http://127.0.0.1:8095';
env.AI_NEWS_RSS_FALLBACK_ENABLED ||= 'true';
env.AI_NEWS_WORKER_ENABLED = 'true';
env.BULLMQ_ENABLED = 'false';
env.REDIS_URL = '';
env.JWT_ACCESS_SECRET ||= 'worker-local-nao-emite-tokens-0123456789abcdef';
env.JWT_REFRESH_SECRET ||= 'worker-local-nao-emite-tokens-fedcba9876543210';

if (!env.DATABASE_URL) {
  console.error('[workers] Defina DATABASE_URL no .env.worker (MySQL da Hostinger com Remote MySQL liberado).');
  process.exit(1);
}

const workers = [
  { name: 'ia-noticias', script: 'src/ai-worker.ts' },
  { name: 'recomendacoes', script: 'src/discovery-worker.ts' },
  { name: 'shop', script: 'src/shop-worker.ts' },
];
// Moderação de imagens precisa do serviço Python NudeNet (Docker). Ative com MODERATION=on.
if ((env.MODERATION || '').toLowerCase() === 'on') {
  env.IMAGE_MODERATION_ENABLED = 'true';
  env.IMAGE_MODERATION_URL ||= 'http://127.0.0.1:8096';
  workers.push({ name: 'moderacao', script: 'src/moderation-worker.ts' });
}
const children = new Set();
for (const w of workers) start(w);

function start(w, attempt = 0) {
  const child = spawn(process.execPath, ['--import', 'tsx', w.script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const prefix = `[${w.name}] `;
  child.stdout.on('data', d => process.stdout.write(String(d).replace(/^/gm, prefix)));
  child.stderr.on('data', d => process.stderr.write(String(d).replace(/^/gm, prefix)));
  child.on('exit', code => {
    children.delete(child);
    if (stopping) return;
    const wait = Math.min(60_000, 2_000 * 2 ** attempt);
    console.warn(`${prefix}parou (código ${code}); reiniciando em ${Math.round(wait / 1000)}s...`);
    setTimeout(() => start(w, Math.min(attempt + 1, 5)), wait);
  });
}

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    for (const c of children) c.kill('SIGTERM');
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
console.log('[workers] IA local iniciada. Saúde: http://localhost:4010/health · Ctrl+C para parar.');
