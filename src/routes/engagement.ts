import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, optionalUser } from '../lib/auth.js';
import { captchaError, verifyCaptcha } from '../lib/captcha.js';
import { randomToken, sha256 } from '../lib/security.js';
import { sendConfirmationEmail, unsubscribeLinks } from '../services/newsletter.js';
import { isAllowedPushEndpoint, pushEnabled } from '../services/push.js';
import { env } from '../config/env.js';
import { clientIp } from '../lib/client-ip.js';
import { stringList } from '../lib/json-array.js';

const TOPIC = z.string().regex(/^(news|releases|cat:[a-z0-9]{8,40})$/);

// Newsletter semanal (double opt-in) e inscrições de Web Push.
const engagementRoutes: FastifyPluginAsync = async app => {
  async function validCategoryIds(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const rows = await prisma.category.findMany({ where: { id: { in: unique } }, select: { id: true } });
    return rows.map(r => r.id);
  }

  app.post(
    '/newsletter/subscribe',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = z
        .object({
          email: z.string().email().max(254),
          categoryIds: z.array(z.string().max(40)).max(50).default([]),
          captchaToken: z.string().max(2048).optional(),
          consent: z.literal(true, { message: 'É necessário concordar em receber a newsletter.' }),
        })
        .parse(req.body);
      const viewer = await optionalUser(req);
      if (!viewer && !(await verifyCaptcha(body.captchaToken, clientIp(req)))) throw captchaError();
      const email = body.email.toLowerCase();
      const categoryIds = await validCategoryIds(body.categoryIds);
      const user = viewer
        ? await prisma.user.findUnique({ where: { id: viewer.id }, select: { email: true, emailVerifiedAt: true } })
        : null;
      // Usuário logado com e-mail já verificado: a posse do e-mail está comprovada, dispensa o segundo clique.
      const verifiedOwner = !!user && user.email === email && !!user.emailVerifiedAt;
      const existing = await prisma.newsletterSubscription.findUnique({ where: { email } });
      if (existing?.status === 'CONFIRMED') {
        await prisma.newsletterSubscription.update({ where: { email }, data: { categoryIds } });
        return { status: 'confirmed' };
      }
      const raw = randomToken();
      const data = {
        categoryIds,
        userId: verifiedOwner ? viewer!.id : (existing?.userId ?? null),
        status: verifiedOwner ? ('CONFIRMED' as const) : ('PENDING' as const),
        confirmTokenHash: verifiedOwner ? null : sha256(raw),
        confirmTokenExpiresAt: verifiedOwner ? null : new Date(Date.now() + 48 * 3600000),
        confirmedAt: verifiedOwner ? new Date() : null,
        unsubscribedAt: null,
        consentIp: sha256(`${clientIp(req)}`).slice(0, 32),
      };
      await prisma.newsletterSubscription.upsert({
        where: { email },
        create: { email, unsubscribeToken: randomToken(), ...data },
        update: data,
      });
      if (!verifiedOwner) await sendConfirmationEmail(email, raw);
      // Resposta idêntica para e-mails novos/antigos: não revela quem já é inscrito.
      return reply.code(202).send({ status: verifiedOwner ? 'confirmed' : 'pending' });
    },
  );

  app.post(
    '/newsletter/confirm',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
      const sub = await prisma.newsletterSubscription.findUnique({ where: { confirmTokenHash: sha256(token) } });
      if (!sub || !sub.confirmTokenExpiresAt || sub.confirmTokenExpiresAt < new Date())
        return reply.code(400).send({ error: 'Link inválido ou expirado. Inscreva-se novamente.' });
      await prisma.newsletterSubscription.update({
        where: { id: sub.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmTokenHash: null, confirmTokenExpiresAt: null },
      });
      return { status: 'confirmed', unsubscribeUrl: unsubscribeLinks(sub.unsubscribeToken).url };
    },
  );

  // GET (link do e-mail via página) e POST (one-click RFC 8058) cancelam a inscrição.
  const unsubscribe = async (token: string) => {
    const sub = await prisma.newsletterSubscription.findUnique({ where: { unsubscribeToken: token } });
    if (!sub) return false;
    await prisma.newsletterSubscription.update({
      where: { id: sub.id },
      data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date() },
    });
    return true;
  };
  app.post(
    '/newsletter/unsubscribe',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const q = z.object({ token: z.string().min(20).max(200).optional() }).parse(req.query ?? {});
      const b = z
        .object({ token: z.string().min(20).max(200).optional() })
        .parse(typeof req.body === 'object' && req.body ? req.body : {});
      const token = b.token || q.token;
      if (!token || !(await unsubscribe(token))) return reply.code(404).send({ error: 'Inscrição não encontrada.' });
      return { status: 'unsubscribed' };
    },
  );

  app.get('/newsletter/me', { preHandler: authenticate }, async req => {
    const user = await prisma.user.findUnique({ where: { id: req.authUser!.id }, select: { email: true } });
    const sub = user
      ? await prisma.newsletterSubscription.findFirst({
          where: { OR: [{ userId: req.authUser!.id }, { email: user.email }] },
          select: { status: true, categoryIds: true, email: true, confirmedAt: true },
        })
      : null;
    return { subscription: sub, email: user?.email };
  });

  app.put(
    '/newsletter/me',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = z
        .object({ subscribed: z.boolean(), categoryIds: z.array(z.string().max(40)).max(50).default([]) })
        .parse(req.body);
      const user = await prisma.user.findUnique({
        where: { id: req.authUser!.id },
        select: { id: true, email: true, emailVerifiedAt: true },
      });
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' });
      const categoryIds = await validCategoryIds(body.categoryIds);
      const existing = await prisma.newsletterSubscription.findUnique({ where: { email: user.email } });
      if (!body.subscribed) {
        if (existing)
          await prisma.newsletterSubscription.update({
            where: { id: existing.id },
            data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date(), categoryIds },
          });
        return { status: 'unsubscribed' };
      }
      const raw = randomToken();
      const confirmed = !!user.emailVerifiedAt;
      const data = {
        userId: user.id,
        categoryIds,
        status: confirmed ? ('CONFIRMED' as const) : ('PENDING' as const),
        confirmedAt: confirmed ? existing?.confirmedAt || new Date() : null,
        confirmTokenHash: confirmed ? null : sha256(raw),
        confirmTokenExpiresAt: confirmed ? null : new Date(Date.now() + 48 * 3600000),
        unsubscribedAt: null,
      };
      await prisma.newsletterSubscription.upsert({
        where: { email: user.email },
        create: { email: user.email, unsubscribeToken: randomToken(), ...data },
        update: data,
      });
      if (!confirmed) await sendConfirmationEmail(user.email, raw);
      return { status: confirmed ? 'confirmed' : 'pending' };
    },
  );

  // ---- Web Push ----
  app.get('/push/public-key', async () => ({
    enabled: pushEnabled(),
    publicKey: pushEnabled() ? env.VAPID_PUBLIC_KEY : null,
  }));

  const subscriptionSchema = z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
    topics: z.array(TOPIC).max(60).default(['news']),
  });

  app.post('/push/subscribe', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    if (!pushEnabled()) return reply.code(503).send({ error: 'Notificações push não configuradas.' });
    const body = subscriptionSchema.parse(req.body);
    if (!isAllowedPushEndpoint(body.endpoint)) return reply.code(400).send({ error: 'Serviço de push não suportado.' });
    const viewer = await optionalUser(req);
    const topics = [...new Set(body.topics)].filter(t => viewer || t !== 'releases');
    const data = {
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      topics,
      userId: viewer?.id ?? null,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
      failures: 0,
    };
    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: { endpoint: body.endpoint, ...data },
      update: data,
    });
    return { ok: true, topics };
  });

  app.post('/push/unsubscribe', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async req => {
    const { endpoint } = z.object({ endpoint: z.string().url().max(1000) }).parse(req.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return { ok: true };
  });

  app.post('/push/status', async req => {
    const { endpoint } = z.object({ endpoint: z.string().url().max(1000) }).parse(req.body);
    const sub = await prisma.pushSubscription.findUnique({ where: { endpoint }, select: { topics: true } });
    return { subscribed: !!sub, topics: stringList(sub?.topics) };
  });
};
export default engagementRoutes;
