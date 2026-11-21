import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rawBody from 'fastify-raw-body';
import { registerUploadServing } from './lib/media-store.js';
import { env, allowedOrigins, trustProxySetting, swaggerEnabled, redisConfigured } from './config/env.js';
import authRoutes from './routes/auth.js';
import contentRoutes from './routes/content.js';
import usersRoutes from './routes/users.js';
import communityRoutes from './routes/community.js';
import libraryRoutes from './routes/library.js';
import catalogRoutes from './routes/catalog.js';
import searchRoutes from './routes/search.js';
import recommendationsRoutes from './routes/recommendations.js';
import adminRoutes from './routes/admin.js';
import uploadRoutes from './routes/uploads.js';
import billingRoutes from './routes/billing.js';
import analyticsRoutes from './routes/analytics.js';
import aiNewsRoutes from './routes/ai-news.js';
import queueRoutes from './routes/queues.js';
import mfaRoutes from './routes/mfa.js';
import engagementRoutes from './routes/engagement.js';
import socialCatalogRoutes from './routes/social-catalog.js';
import communityModerationRoutes from './routes/community-moderation.js';
import revenueRoutes from './routes/revenue.js';
import shopRoutes from './routes/shop.js';
import settingsRoutes from './routes/settings.js';
import translationsRoutes from './routes/translations.js';
import { API_FEATURES, API_VERSION, databaseSchemaStatus } from './lib/schema-status.js';
import mediaRoutes from './routes/media.js';
import { Redis } from 'ioredis';
import { redisOptions } from './lib/redis.js';
import { ACCESS_COOKIE, csrfGuard } from './lib/auth.js';
import { isZodError } from './lib/validation.js';
import { clientIp, GATEWAY_CLIENT_IP_HEADER, isTrustedGateway } from './lib/client-ip.js';

export async function buildApp() {
  // bodyLimit global pequeno (anti-DoS). Rotas do CMS que recebem HTML grande
  // declaram bodyLimit próprio. Logs nunca devem registrar Authorization/cookies.
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'], remove: true },
    },
    bodyLimit: 1 * 1024 * 1024,
    trustProxy: trustProxySetting as any,
  });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', String(req.id));
    reply.header('x-nexverse-api-version', 'v17-bullmq-community');
  });

  // Registre o handler ANTES dos plugins de rota. Em Fastify os error handlers são
  // encapsulados pelo contexto de plugin; fazer isso depois pode deixar rotas filhas
  // usando o handler padrão e esconder a causa real atrás de "Internal Server Error".
  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith('/api/');
    return reply.code(404).send({
      error: isApi ? 'Esta função não existe nesta versão da API.' : 'Página não encontrada.',
      message: isApi ? 'Esta função não existe nesta versão da API.' : 'Página não encontrada.',
      code: 'ROUTE_NOT_FOUND',
      path: req.url.split('?')[0],
      apiVersion: API_VERSION,
    });
  });

  app.setErrorHandler((error: any, req, reply) => {
    const requestId = String(req.id);
    if (isZodError(error))
      return reply
        .code(400)
        .send({ error: 'Dados inválidos', message: 'Dados inválidos', issues: error.issues, requestId });

    const code = String((error as any).code || '');
    const explicitStatus = Number((error as any).statusCode || 0);
    if (explicitStatus >= 400 && explicitStatus < 500) {
      return reply
        .code(explicitStatus)
        .send({ error: error.message, message: error.message, code: code || 'REQUEST_ERROR', requestId });
    }
    if (code.startsWith('IMAGE_MODERATION_')) {
      const status = explicitStatus >= 500 && explicitStatus < 600 ? explicitStatus : 503;
      req.log.warn(
        { err: error, method: req.method, url: req.url, requestId, code },
        'Serviço local de moderação indisponível',
      );
      return reply.code(status).send({ error: error.message, message: error.message, code, requestId });
    }
    if (code === 'P2002')
      return reply.code(409).send({
        error: 'Já existe um registro com estes dados.',
        message: 'Já existe um registro com estes dados.',
        code,
        requestId,
      });
    if (code === 'P2003')
      return reply.code(400).send({
        error: 'Um dos vínculos enviados não existe mais no banco. Atualize a página e tente novamente.',
        message: 'Um dos vínculos enviados não existe mais no banco. Atualize a página e tente novamente.',
        code,
        requestId,
      });
    if (code === 'P2025')
      return reply
        .code(404)
        .send({ error: 'Registro não encontrado.', message: 'Registro não encontrado.', code, requestId });
    if (code === 'P2021' || code === 'P2022') {
      const what = String((error as any).meta?.table || (error as any).meta?.column || (error as any).meta?.modelName || '');
      req.log.error({ err: error, requestId, what }, 'Banco sem tabela/coluna esperada');
      return reply.code(503).send({
        error: 'Este recurso está temporariamente indisponível. Tente novamente mais tarde.',
        message: `O banco de dados está desatualizado${what ? ` (falta: ${what})` : ''}. Rode "npm run db:sync" na pasta hypeverso-api com a DATABASE_URL do MySQL remoto.`,
        code: 'DB_SCHEMA_OUTDATED',
        missing: what || null,
        requestId,
      });
    }
    if (code === 'P1001' || code === 'P1002' || code === 'P2024')
      return reply.code(503).send({
        error: 'Banco de dados temporariamente indisponível ou sem conexão livre. Tente novamente em alguns segundos.',
        message:
          'Banco de dados temporariamente indisponível ou sem conexão livre. Tente novamente em alguns segundos.',
        code,
        requestId,
      });
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE')
      return reply.code(413).send({
        error: 'O artigo excedeu o tamanho máximo permitido pela API.',
        message: 'O artigo excedeu o tamanho máximo permitido pela API.',
        code,
        requestId,
      });
    if (code === 'P2034' || code === 'P2028')
      return reply.code(409).send({
        error: 'Não foi possível concluir a transação do artigo. Tente salvar novamente.',
        message: 'Não foi possível concluir a transação do artigo. Tente salvar novamente.',
        code,
        requestId,
      });

    req.log.error({ err: error, method: req.method, url: req.url, requestId }, 'Falha na requisição');
    const message =
      env.NODE_ENV === 'production'
        ? 'Não foi possível concluir a operação. Consulte o requestId nos logs da API.'
        : error.message || 'Falha interna na API';
    return reply.code(500).send({
      error: message,
      message,
      code: code || 'INTERNAL_ERROR',
      requestId,
    });
  });

  // API só devolve JSON/arquivos: CSP restritiva não quebra nada aqui. A UI do
  // Swagger (quando habilitada) precisa de inline scripts, por isso é relaxada só lá.
  await app.register(helmet, {
    contentSecurityPolicy: swaggerEnabled
      ? false
      : { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], imgSrc: ["'self'", 'data:'] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  // A compressão HTTP fica no proxy/reverse-proxy de produção. Manter a API sem
  // compressão interna evita respostas JSON binárias/corrompidas ao atravessar o
  // gateway do Next.js (o browser já negocia compressão com o próprio Next).
  await app.register(cors, {
    origin: (origin, cb) => {
      // Origem desconhecida: apenas não recebe cabeçalhos CORS (o navegador bloqueia a leitura).
      // Antes isso virava erro 500; requisições com cookie ainda passam pelo csrfGuard (403).
      cb(null, !origin || allowedOrigins.includes(origin));
    },
    credentials: true,
  });
  // Rate limit com store no Redis: o limite vale para todas as instâncias da API
  // (antes era em memória, por processo). Se o Redis cair, o limite é ignorado
  // em vez de derrubar a API (skipOnError).
  const rateLimitRedis =
    redisConfigured && env.RATE_LIMIT_REDIS === 'true' && env.NODE_ENV !== 'test'
      ? new Redis(
          env.REDIS_URL,
          redisOptions({ connectTimeout: 500, maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false }),
        )
      : undefined;
  rateLimitRedis?.on('error', () => undefined);
  if (rateLimitRedis) app.addHook('onClose', async () => void rateLimitRedis.quit().catch(() => undefined));
  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: req => clientIp(req),
    // Renderização do servidor do site (SSR/ISR na Hostinger) sai sempre do mesmo IP;
    // ela se identifica com o segredo do gateway e não entra no limite por visitante.
    allowList: req => isTrustedGateway(req) && !req.headers[GATEWAY_CLIENT_IP_HEADER],
    ...(rateLimitRedis ? { redis: rateLimitRedis, nameSpace: 'hv-rl:', skipOnError: true } : {}),
  });
  await app.register(cookie);
  // Formulários simples (ex.: one-click unsubscribe RFC 8058 enviado pelos provedores de e-mail).
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 4096 },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );
  // CSRF (double-submit) para sessões por cookie. Roda antes de qualquer rota.
  app.addHook('preHandler', csrfGuard);
  await app.register(rawBody, { field: 'rawBody', global: false, encoding: 'utf8', runFirst: true });
  // Access token aceito no header Authorization (mobile) ou no cookie HttpOnly (web).
  await app.register(jwt, { secret: env.JWT_ACCESS_SECRET, cookie: { cookieName: ACCESS_COOKIE, signed: false } });
  await app.register(multipart, {
    limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 10, parts: 12, fieldSize: 100 * 1024 },
  });
  if (swaggerEnabled) {
    await app.register(swagger, { openapi: { info: { title: 'Hypeverso API', version: '1.0.0' } } });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }
  // Imagens servidas do MySQL (MediaAsset); arquivos antigos em disco continuam funcionando.
  registerUploadServing(app);
  app.get('/health', async () => ({ status: 'ok', service: 'nexverse-api', time: new Date().toISOString() }));
  // Versão + funções disponíveis + tabelas que faltam (o CMS mostra um aviso amigável).
  app.get('/api/health', async () => ({
    status: 'ok',
    version: API_VERSION,
    features: API_FEATURES,
    database: await databaseSchemaStatus(),
    time: new Date().toISOString(),
  }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(mfaRoutes, { prefix: '/api' });
  await app.register(engagementRoutes, { prefix: '/api' });
  await app.register(socialCatalogRoutes, { prefix: '/api' });
  await app.register(communityModerationRoutes, { prefix: '/api' });
  await app.register(revenueRoutes, { prefix: '/api' });
  await app.register(contentRoutes, { prefix: '/api' });
  await app.register(aiNewsRoutes, { prefix: '/api' });
  await app.register(queueRoutes, { prefix: '/api' });
  await app.register(usersRoutes, { prefix: '/api' });
  await app.register(communityRoutes, { prefix: '/api' });
  await app.register(libraryRoutes, { prefix: '/api' });
  await app.register(catalogRoutes, { prefix: '/api' });
  await app.register(searchRoutes, { prefix: '/api' });
  await app.register(recommendationsRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api' });
  await app.register(uploadRoutes, { prefix: '/api' });
  await app.register(billingRoutes, { prefix: '/api' });
  await app.register(analyticsRoutes, { prefix: '/api' });
  await app.register(shopRoutes, { prefix: '/api' });
  await app.register(settingsRoutes, { prefix: '/api' });
  await app.register(translationsRoutes, { prefix: '/api' });
  await app.register(mediaRoutes, { prefix: '/api' });
  return app;
}
