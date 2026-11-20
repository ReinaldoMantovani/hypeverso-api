import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export type Harness = {
  app: any;
  prisma: any;
  stop: () => Promise<void>;
};

/**
 * Sobe um MySQL descartável, sincroniza o schema com `prisma db push`
 * e só então importa a API (o env é lido no import).
 */
export async function startHarness(extraEnv: Record<string, string> = {}): Promise<Harness> {
  // MySQL igual ao da Hostinger. Sem Redis: a API usa o modo em memória (como em produção).
  const db: StartedMySqlContainer = await new MySqlContainer('mysql:8.4')
    .withDatabase('hypeverso')
    .withUsername('hypeverso')
    .withUserPassword('hypeverso')
    .start();
  const databaseUrl = `mysql://hypeverso:hypeverso@${db.getHost()}:${db.getPort()}/hypeverso?connection_limit=5`;
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: '',
    JWT_ACCESS_SECRET: 'integration-access-secret-0123456789abcdef',
    JWT_REFRESH_SECRET: 'integration-refresh-secret-0123456789abcdef',
    MFA_ENCRYPTION_KEY: 'integration-mfa-key-0123456789abcdef0123',
    PUBLIC_WEB_URL: 'http://localhost:3000',
    CORS_ORIGIN: 'http://localhost:3000',
    BULLMQ_ENABLED: 'false',
    RATE_LIMIT_REDIS: 'false',
    REQUIRE_EMAIL_VERIFICATION: 'true',
    ...extraEnv,
  });
  execSync('npx prisma db push --skip-generate', {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  const { prisma } = await import('../../src/db.js');
  const { redis: redisClient } = await import('../../src/lib/redis.js');
  await redisClient.connect().catch(() => undefined);
  const { buildApp } = await import('../../src/app.js');
  const app = await buildApp();
  await app.ready();
  return {
    app,
    prisma,
    stop: async () => {
      await app.close();
      await prisma.$disconnect();
      redisClient.disconnect();
      await db.stop();
    },
  };
}

/** Mini "navegador": guarda cookies entre requisições e envia o token CSRF. */
export class CookieJar {
  cookies = new Map<string, string>();
  // IP próprio por "navegador" para não esbarrar nos rate limits por IP durante os testes.
  ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
  constructor(private app: any) {}
  store(res: any) {
    for (const c of res.cookies as { name: string; value: string; maxAge?: number }[]) {
      if (c.value === '' || c.maxAge === 0) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }
  async request(method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) {
    const csrf = this.cookies.get('nv_csrf');
    const res = await this.app.inject({
      method,
      url,
      payload: payload as any,
      cookies: Object.fromEntries(this.cookies),
      remoteAddress: this.ip,
      headers: {
        origin: 'http://localhost:3000',
        ...(csrf && method !== 'GET' ? { 'x-csrf-token': csrf } : {}),
        ...headers,
      },
    });
    return this.store(res);
  }
}
