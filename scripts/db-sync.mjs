// Sincroniza o schema do Prisma com o MySQL e popula categorias/conquistas.
// Roda no "build" da Hostinger (onde o MySQL é acessível) e pode ser rodado à mão:
//   npm run db:sync
// Variáveis: DB_SYNC=off desliga; DB_SYNC=strict faz o build falhar se der erro.
import { spawnSync } from 'node:child_process';

const mode = (process.env.DB_SYNC || 'on').toLowerCase();
if (mode === 'off') {
  console.log('[db-sync] DB_SYNC=off: pulando sincronização do banco.');
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.warn('[db-sync] DATABASE_URL não definida no build: pulando. Rode "npm run db:sync" depois.');
  process.exit(0);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
}

// db push NUNCA apaga dados sem --accept-data-loss: se uma mudança for destrutiva, ele para e avisa.
const pushed = run('npx', ['prisma', 'db', 'push', '--skip-generate']);
const seeded = pushed && run('npx', ['tsx', 'prisma/seed.ts']);

if (!pushed || !seeded) {
  const msg =
    '[db-sync] Não foi possível sincronizar o banco agora. A API continua sendo construída; ' +
    'rode "npm run db:sync" no seu PC (com o Remote MySQL liberado) ou veja o log acima.';
  if (mode === 'strict') {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
}
