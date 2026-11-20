import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  // Redis é OPCIONAL. Vazio (Hostinger Business) = cache, deduplicação e rate limit em memória.
  REDIS_URL: z.string().default(''),

  // BullMQ Community / Open Source. Não usa BullMQ Pro nem serviços pagos.
  // BullMQ exige Redis. Sem Redis os jobs de IA são lidos direto do MySQL pelo worker local.
  BULLMQ_ENABLED: z.string().default('false'),
  BULLMQ_PREFIX: z.string().default('nexverse'),
  BULLMQ_AI_NEWS_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  BULLMQ_BACKOFF_MS: z.coerce.number().int().min(500).max(300000).default(5000),
  BULLMQ_SYSTEM_CONCURRENCY: z.coerce.number().int().min(1).max(25).default(5),
  BULLMQ_AI_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  BULLMQ_DISCOVERY_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  QUEUE_WORKER_HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(4030),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: z.string().default('false'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('Hypeverso <no-reply@hypeverso.local>'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PREMIUM_PRICE_ID: z.string().optional(),
  ASSET_BASE_URL: z.string().url().default('http://localhost:4000'),
  LOG_LEVEL: z.string().default('info'),

  // Hypeverso Media Hub
  TMDB_READ_TOKEN: z.string().optional(),
  IGDB_CLIENT_ID: z.string().optional(),
  IGDB_CLIENT_SECRET: z.string().optional(),
  MEDIA_CATALOG_CACHE_HOURS: z.coerce.number().int().min(1).max(168).default(24),

  // Search 2.0 / Discovery
  // Meilisearch é OPCIONAL. Vazio = busca direto no MySQL.
  MEILISEARCH_URL: z.union([z.string().url(), z.literal('')]).default(''),
  MEILI_MASTER_KEY: z.string().default('nexverse-local-meili-master-key'),
  MEILI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  EMBEDDING_MODEL: z.string().default('qwen3-embedding:0.6b'),
  EMBEDDING_AUTO_PULL: z.string().default('true'),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(5000).max(1800000).default(900000),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(12),
  DISCOVERY_POLL_MS: z.coerce.number().int().min(5000).max(3600000).default(60000),
  DISCOVERY_FULL_REINDEX_EVERY: z.coerce.number().int().min(1).max(1440).default(10),
  DISCOVERY_WORKER_HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(4020),

  OLLAMA_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen3:4b-instruct'),
  OLLAMA_FALLBACK_MODELS: z.string().default('qwen3:1.7b,qwen2.5:3b'),
  SEARXNG_URL: z.string().url().default('http://localhost:8080'),
  ARTICLE_EXTRACTOR_URL: z.string().url().default('http://localhost:8095'),
  IMAGE_MODERATION_URL: z.string().url().default('http://localhost:8096'),
  // Moderação de imagens (NudeNet/Python) não roda na Hostinger: desligada por padrão.
  IMAGE_MODERATION_ENABLED: z.string().default('false'),
  IMAGE_MODERATION_RETRIES: z.coerce.number().int().min(0).max(6).default(3),
  IMAGE_MODERATION_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(60000),
  AI_NEWS_EXTRACTOR_ENABLED: z.string().default('true'),

  // Na Hostinger fica false: quem processa a IA é o worker no seu PC.
  AI_NEWS_WORKER_ENABLED: z.string().default('false'),
  AI_NEWS_POLL_MS: z.coerce.number().min(2000).default(5000),
  AI_NEWS_SOURCE_LIMIT: z.coerce.number().min(1).max(5).default(3),
  AI_NEWS_FETCH_TIMEOUT_MS: z.coerce.number().min(3000).max(120000).default(25000),
  AI_NEWS_SEARCH_TIMEOUT_MS: z.coerce.number().min(3000).max(120000).default(30000),
  AI_NEWS_FETCH_RETRIES: z.coerce.number().int().min(0).max(4).default(2),
  AI_NEWS_RSS_FALLBACK_ENABLED: z.string().default('true'),
  AI_NEWS_LLM_TIMEOUT_MS: z.coerce.number().min(60000).max(1800000).default(720000),
  AI_NEWS_LLM_IDLE_TIMEOUT_MS: z.coerce.number().min(15000).max(300000).default(180000),
  AI_NEWS_LLM_NUM_CTX: z.coerce.number().int().min(4096).max(32768).default(8192),
  AI_NEWS_LLM_NUM_PREDICT: z.coerce.number().int().min(512).max(4096).default(3200),
  AI_NEWS_STALE_JOB_MS: z.coerce.number().min(300000).max(7200000).default(1200000),
  AI_NEWS_AUTO_PULL_MODEL: z.string().default('true'),
  AI_NEWS_MODEL_PULL_TIMEOUT_MS: z.coerce.number().min(60000).max(7200000).default(1800000),
  AI_NEWS_DEPENDENCY_RETRY_MS: z.coerce.number().min(2000).max(60000).default(5000),
  AI_NEWS_WORKER_HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(4010),
  AI_NEWS_WORKER_HEALTH_URL: z.string().url().default('http://127.0.0.1:4010'),

  // Segurança de borda
  // Quais proxies são confiáveis para X-Forwarded-For. "true" (antigo) permitia que
  // qualquer cliente falsificasse o IP e escapasse do rate limit. O padrão confia
  // apenas em loopback e redes privadas (gateway Next.js / proxy reverso no Docker).
  TRUST_PROXY: z.string().default('loopback,linklocal,uniquelocal'),
  // O site (Hostinger) e o CMS local chegam à API por um gateway server-side. Ele
  // envia o IP real do visitante em x-hv-client-ip junto com este segredo; sem o
  // segredo correto o cabeçalho é ignorado (não dá para falsificar IP de fora).
  GATEWAY_SHARED_SECRET: z.string().optional(),
  // Shop: tempo máximo para ler a página do produto ao gerar o preview no CMS.
  SHOP_PREVIEW_TIMEOUT_MS: z.coerce.number().int().min(2000).max(60000).default(12000),
  // Swagger UI expõe o mapa completo da API; em produção fica desligado por padrão.
  ENABLE_SWAGGER: z.string().optional(),
  // Versão vigente dos Termos/Política aceita no cadastro.
  LEGAL_TERMS_VERSION: z.string().default('2026-10-15'),

  // Redis: senha vem no REDIS_URL (redis://:senha@host:6379). Use rediss:// para TLS.
  REDIS_TLS_CA_FILE: z.string().optional(),
  REDIS_TLS_REJECT_UNAUTHORIZED: z.string().default('true'),
  RATE_LIMIT_REDIS: z.string().default('false'),

  // 2FA (TOTP). Chave usada para cifrar os segredos TOTP no banco (AES-256-GCM).
  MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
  MFA_REQUIRED_FOR_STAFF: z.string().default('true'),
  MFA_ISSUER: z.string().default('Hypeverso'),

  // Anti-spam
  // auto = exige e-mail verificado quando o SMTP estiver configurado.
  REQUIRE_EMAIL_VERIFICATION: z.enum(['auto', 'true', 'false']).default('auto'),
  TURNSTILE_SECRET_KEY: z.string().optional(),

  // Web Push (gere com: npx web-push generate-vapid-keys)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:contato@hypeverso.com'),

  // Newsletter semanal
  NEWSLETTER_ENABLED: z.string().default('true'),
  // Dia da semana (0=domingo) e hora (UTC) do envio do resumo.
  NEWSLETTER_WEEKDAY: z.coerce.number().int().min(0).max(6).default(5),
  NEWSLETTER_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(12),

  // Contagem de visualizações agregada no Redis
  VIEW_FLUSH_MS: z.coerce.number().int().min(2000).max(600000).default(15000),

  // Painel de receita: AdSense Management API (OAuth2 com refresh token)
  ADSENSE_ACCOUNT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional(),

  // Onde assistir (TMDB watch providers / JustWatch)
  WATCH_PROVIDERS_REGION: z.string().length(2).default('BR'),
});

// Variáveis vazias (comuns em painéis como o da Hostinger) contam como "não definidas".
const rawEnv: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== ''),
);
// Hostinger (e outros PaaS) informam a porta em PORT.
if (!rawEnv.API_PORT && rawEnv.PORT) rawEnv.API_PORT = rawEnv.PORT;
export const env = schema.parse(rawEnv);

/** Há Redis configurado? Sem ele usamos implementações em memória (um processo). */
export const redisConfigured = Boolean(env.REDIS_URL.trim());
/** Meilisearch configurado? Sem ele a busca usa o MySQL. */
export const meiliConfigured = Boolean(env.MEILISEARCH_URL.trim());

// Falha rápida: nunca suba produção com segredos de exemplo/fracos.
if (env.NODE_ENV === 'production') {
  const weak = (value: string) => /change-me|change-before-production|nexverse-local|^secret$|example/i.test(value);
  const problems: string[] = [];
  if (weak(env.JWT_ACCESS_SECRET)) problems.push('JWT_ACCESS_SECRET usa valor de exemplo');
  if (weak(env.JWT_REFRESH_SECRET)) problems.push('JWT_REFRESH_SECRET usa valor de exemplo');
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET)
    problems.push('JWT_ACCESS_SECRET e JWT_REFRESH_SECRET devem ser diferentes');
  if (env.MEILISEARCH_URL && weak(env.MEILI_MASTER_KEY)) problems.push('MEILI_MASTER_KEY usa valor de exemplo');
  if (env.COOKIE_SECURE !== 'true') problems.push('COOKIE_SECURE deve ser true em produção (HTTPS)');
  if (!env.PUBLIC_WEB_URL.startsWith('https://')) problems.push('PUBLIC_WEB_URL deve usar https:// em produção');
  if (env.REDIS_URL) {
    try {
      const redisUrl = new URL(env.REDIS_URL);
      if (!redisUrl.password) problems.push('REDIS_URL precisa de senha em produção (redis://:SENHA@host:6379)');
    } catch {
      problems.push('REDIS_URL inválida');
    }
  }
  if (!env.MFA_ENCRYPTION_KEY) problems.push('MFA_ENCRYPTION_KEY é obrigatória em produção (32+ caracteres)');
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(`[config] Configuração insegura para produção:\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }
}

export const trustProxySetting: boolean | number | string[] = (() => {
  const raw = env.TRUST_PROXY.trim();
  if (raw === 'true') return true;
  if (raw === 'false' || raw === '') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
})();

export const swaggerEnabled = env.ENABLE_SWAGGER ? env.ENABLE_SWAGGER === 'true' : env.NODE_ENV !== 'production';
export const allowedOrigins = env.CORS_ORIGIN.split(',')
  .map(v => v.trim())
  .filter(Boolean);

export const emailVerificationRequired =
  env.REQUIRE_EMAIL_VERIFICATION === 'true' ||
  (env.REQUIRE_EMAIL_VERIFICATION === 'auto' && Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD));
export const mfaRequiredForStaff = env.MFA_REQUIRED_FOR_STAFF !== 'false';
