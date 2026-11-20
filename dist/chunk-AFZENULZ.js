import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));

// src/db.ts
var db_exports = {};
__export(db_exports, {
  prisma: () => prisma
});
__reExport(db_exports, client_star);
import { PrismaClient } from "@prisma/client";
import * as client_star from "@prisma/client";
var globalForPrisma = globalThis;
var prisma = globalForPrisma.prisma ?? new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// src/config/env.ts
import { z } from "zod";
var schema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  API_PORT: z.coerce.number().default(4e3),
  DATABASE_URL: z.string().min(1),
  // Redis é OPCIONAL. Vazio (Hostinger Business) = cache, deduplicação e rate limit em memória.
  REDIS_URL: z.string().default(""),
  // BullMQ Community / Open Source. Não usa BullMQ Pro nem serviços pagos.
  // BullMQ exige Redis. Sem Redis os jobs de IA são lidos direto do MySQL pelo worker local.
  BULLMQ_ENABLED: z.string().default("false"),
  BULLMQ_PREFIX: z.string().default("nexverse"),
  BULLMQ_AI_NEWS_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  BULLMQ_BACKOFF_MS: z.coerce.number().int().min(500).max(3e5).default(5e3),
  BULLMQ_SYSTEM_CONCURRENCY: z.coerce.number().int().min(1).max(25).default(5),
  BULLMQ_AI_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  BULLMQ_DISCOVERY_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  QUEUE_WORKER_HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(4030),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:3000"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: z.string().default("false"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("Hypeverso <no-reply@hypeverso.local>"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PREMIUM_PRICE_ID: z.string().optional(),
  ASSET_BASE_URL: z.string().url().default("http://localhost:4000"),
  LOG_LEVEL: z.string().default("info"),
  // Hypeverso Media Hub
  TMDB_READ_TOKEN: z.string().optional(),
  IGDB_CLIENT_ID: z.string().optional(),
  IGDB_CLIENT_SECRET: z.string().optional(),
  MEDIA_CATALOG_CACHE_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  // Search 2.0 / Discovery
  // Meilisearch é OPCIONAL. Vazio = busca direto no MySQL.
  MEILISEARCH_URL: z.union([z.string().url(), z.literal("")]).default(""),
  MEILI_MASTER_KEY: z.string().default("nexverse-local-meili-master-key"),
  MEILI_TIMEOUT_MS: z.coerce.number().int().min(1e3).max(6e4).default(1e4),
  EMBEDDING_MODEL: z.string().default("qwen3-embedding:0.6b"),
  EMBEDDING_AUTO_PULL: z.string().default("true"),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(5e3).max(18e5).default(9e5),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(12),
  DISCOVERY_POLL_MS: z.coerce.number().int().min(5e3).max(36e5).default(6e4),
  DISCOVERY_FULL_REINDEX_EVERY: z.coerce.number().int().min(1).max(1440).default(10),
  DISCOVERY_WORKER_HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(4020),
  OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen3:4b-instruct"),
  OLLAMA_FALLBACK_MODELS: z.string().default("qwen3:1.7b,qwen2.5:3b"),
  SEARXNG_URL: z.string().url().default("http://localhost:8080"),
  ARTICLE_EXTRACTOR_URL: z.string().url().default("http://localhost:8095"),
  IMAGE_MODERATION_URL: z.string().url().default("http://localhost:8096"),
  // Moderação de imagens (NudeNet/Python) não roda na Hostinger: desligada por padrão.
  IMAGE_MODERATION_ENABLED: z.string().default("false"),
  IMAGE_MODERATION_RETRIES: z.coerce.number().int().min(0).max(6).default(3),
  IMAGE_MODERATION_TIMEOUT_MS: z.coerce.number().int().min(5e3).max(12e4).default(6e4),
  AI_NEWS_EXTRACTOR_ENABLED: z.string().default("true"),
  // Na Hostinger fica false: quem processa a IA é o worker no seu PC.
  AI_NEWS_WORKER_ENABLED: z.string().default("false"),
  AI_NEWS_POLL_MS: z.coerce.number().min(2e3).default(5e3),
  AI_NEWS_SOURCE_LIMIT: z.coerce.number().min(1).max(5).default(3),
  AI_NEWS_FETCH_TIMEOUT_MS: z.coerce.number().min(3e3).max(12e4).default(25e3),
  AI_NEWS_SEARCH_TIMEOUT_MS: z.coerce.number().min(3e3).max(12e4).default(3e4),
  AI_NEWS_FETCH_RETRIES: z.coerce.number().int().min(0).max(4).default(2),
  AI_NEWS_RSS_FALLBACK_ENABLED: z.string().default("true"),
  AI_NEWS_LLM_TIMEOUT_MS: z.coerce.number().min(6e4).max(18e5).default(72e4),
  AI_NEWS_LLM_IDLE_TIMEOUT_MS: z.coerce.number().min(15e3).max(3e5).default(18e4),
  AI_NEWS_LLM_NUM_CTX: z.coerce.number().int().min(4096).max(32768).default(8192),
  AI_NEWS_LLM_NUM_PREDICT: z.coerce.number().int().min(512).max(4096).default(3200),
  AI_NEWS_STALE_JOB_MS: z.coerce.number().min(3e5).max(72e5).default(12e5),
  AI_NEWS_AUTO_PULL_MODEL: z.string().default("true"),
  AI_NEWS_MODEL_PULL_TIMEOUT_MS: z.coerce.number().min(6e4).max(72e5).default(18e5),
  AI_NEWS_DEPENDENCY_RETRY_MS: z.coerce.number().min(2e3).max(6e4).default(5e3),
  AI_NEWS_WORKER_HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(4010),
  AI_NEWS_WORKER_HEALTH_URL: z.string().url().default("http://127.0.0.1:4010"),
  // Segurança de borda
  // Quais proxies são confiáveis para X-Forwarded-For. "true" (antigo) permitia que
  // qualquer cliente falsificasse o IP e escapasse do rate limit. O padrão confia
  // apenas em loopback e redes privadas (gateway Next.js / proxy reverso no Docker).
  TRUST_PROXY: z.string().default("loopback,linklocal,uniquelocal"),
  // O site (Hostinger) e o CMS local chegam à API por um gateway server-side. Ele
  // envia o IP real do visitante em x-hv-client-ip junto com este segredo; sem o
  // segredo correto o cabeçalho é ignorado (não dá para falsificar IP de fora).
  GATEWAY_SHARED_SECRET: z.string().optional(),
  // Shop: tempo máximo para ler a página do produto ao gerar o preview no CMS.
  SHOP_PREVIEW_TIMEOUT_MS: z.coerce.number().int().min(2e3).max(6e4).default(12e3),
  // Swagger UI expõe o mapa completo da API; em produção fica desligado por padrão.
  ENABLE_SWAGGER: z.string().optional(),
  // Versão vigente dos Termos/Política aceita no cadastro.
  LEGAL_TERMS_VERSION: z.string().default("2026-10-15"),
  // Redis: senha vem no REDIS_URL (redis://:senha@host:6379). Use rediss:// para TLS.
  REDIS_TLS_CA_FILE: z.string().optional(),
  REDIS_TLS_REJECT_UNAUTHORIZED: z.string().default("true"),
  RATE_LIMIT_REDIS: z.string().default("false"),
  // 2FA (TOTP). Chave usada para cifrar os segredos TOTP no banco (AES-256-GCM).
  MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
  MFA_REQUIRED_FOR_STAFF: z.string().default("true"),
  MFA_ISSUER: z.string().default("Hypeverso"),
  // Anti-spam
  // auto = exige e-mail verificado quando o SMTP estiver configurado.
  REQUIRE_EMAIL_VERIFICATION: z.enum(["auto", "true", "false"]).default("auto"),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  // Web Push (gere com: npx web-push generate-vapid-keys)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:contato@hypeverso.com"),
  // Newsletter semanal
  NEWSLETTER_ENABLED: z.string().default("true"),
  // Dia da semana (0=domingo) e hora (UTC) do envio do resumo.
  NEWSLETTER_WEEKDAY: z.coerce.number().int().min(0).max(6).default(5),
  NEWSLETTER_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(12),
  // Contagem de visualizações agregada no Redis
  VIEW_FLUSH_MS: z.coerce.number().int().min(2e3).max(6e5).default(15e3),
  // Painel de receita: AdSense Management API (OAuth2 com refresh token)
  ADSENSE_ACCOUNT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional(),
  // Onde assistir (TMDB watch providers / JustWatch)
  WATCH_PROVIDERS_REGION: z.string().length(2).default("BR")
});
var rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== "")
);
if (!rawEnv.API_PORT && rawEnv.PORT) rawEnv.API_PORT = rawEnv.PORT;
var env = schema.parse(rawEnv);
var redisConfigured = Boolean(env.REDIS_URL.trim());
var meiliConfigured = Boolean(env.MEILISEARCH_URL.trim());
if (env.NODE_ENV === "production") {
  const weak = (value) => /change-me|change-before-production|nexverse-local|^secret$|example/i.test(value);
  const problems = [];
  if (weak(env.JWT_ACCESS_SECRET)) problems.push("JWT_ACCESS_SECRET usa valor de exemplo");
  if (weak(env.JWT_REFRESH_SECRET)) problems.push("JWT_REFRESH_SECRET usa valor de exemplo");
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET)
    problems.push("JWT_ACCESS_SECRET e JWT_REFRESH_SECRET devem ser diferentes");
  if (env.MEILISEARCH_URL && weak(env.MEILI_MASTER_KEY)) problems.push("MEILI_MASTER_KEY usa valor de exemplo");
  if (env.COOKIE_SECURE !== "true") problems.push("COOKIE_SECURE deve ser true em produ\xE7\xE3o (HTTPS)");
  if (!env.PUBLIC_WEB_URL.startsWith("https://")) problems.push("PUBLIC_WEB_URL deve usar https:// em produ\xE7\xE3o");
  if (env.REDIS_URL) {
    try {
      const redisUrl = new URL(env.REDIS_URL);
      if (!redisUrl.password) problems.push("REDIS_URL precisa de senha em produ\xE7\xE3o (redis://:SENHA@host:6379)");
    } catch {
      problems.push("REDIS_URL inv\xE1lida");
    }
  }
  if (!env.MFA_ENCRYPTION_KEY) problems.push("MFA_ENCRYPTION_KEY \xE9 obrigat\xF3ria em produ\xE7\xE3o (32+ caracteres)");
  if (problems.length) {
    console.error(`[config] Configura\xE7\xE3o insegura para produ\xE7\xE3o:
 - ${problems.join("\n - ")}`);
    process.exit(1);
  }
}
var trustProxySetting = (() => {
  const raw = env.TRUST_PROXY.trim();
  if (raw === "true") return true;
  if (raw === "false" || raw === "") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw.split(",").map((v) => v.trim()).filter(Boolean);
})();
var swaggerEnabled = env.ENABLE_SWAGGER ? env.ENABLE_SWAGGER === "true" : env.NODE_ENV !== "production";
var allowedOrigins = env.CORS_ORIGIN.split(",").map((v) => v.trim()).filter(Boolean);
var emailVerificationRequired = env.REQUIRE_EMAIL_VERIFICATION === "true" || env.REQUIRE_EMAIL_VERIFICATION === "auto" && Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
var mfaRequiredForStaff = env.MFA_REQUIRED_FOR_STAFF !== "false";

export {
  prisma,
  db_exports,
  env,
  redisConfigured,
  meiliConfigured,
  trustProxySetting,
  swaggerEnabled,
  allowedOrigins,
  emailVerificationRequired,
  mfaRequiredForStaff
};
//# sourceMappingURL=chunk-AFZENULZ.js.map