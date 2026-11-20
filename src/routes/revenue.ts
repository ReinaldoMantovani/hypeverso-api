import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../lib/auth.js';
import { revenueOverview } from '../services/revenue.js';
import { sendWeeklyDigest } from '../services/newsletter.js';
import { prisma } from '../db.js';

const revenueRoutes: FastifyPluginAsync = async app => {
  app.get('/admin/revenue', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const { fresh } = z.object({ fresh: z.enum(['1', 'true']).optional() }).parse(req.query);
    reply.header('cache-control', 'no-store');
    return revenueOverview(Boolean(fresh));
  });

  app.get('/admin/newsletter', { preHandler: requireRole('ADMIN') }, async () => {
    const [confirmed, pending, unsubscribed, push] = await Promise.all([
      prisma.newsletterSubscription.count({ where: { status: 'CONFIRMED' } }),
      prisma.newsletterSubscription.count({ where: { status: 'PENDING' } }),
      prisma.newsletterSubscription.count({ where: { status: 'UNSUBSCRIBED' } }),
      prisma.pushSubscription.count(),
    ]);
    return { newsletter: { confirmed, pending, unsubscribed }, pushSubscriptions: push };
  });

  // Envio manual do resumo semanal (ignora a trava da semana).
  app.post(
    '/admin/newsletter/send',
    { preHandler: requireRole('ADMIN'), config: { rateLimit: { max: 2, timeWindow: '1 hour' } } },
    async req => sendWeeklyDigest(req.log, true),
  );
};
export default revenueRoutes;
