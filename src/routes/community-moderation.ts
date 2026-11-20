import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate } from '../lib/auth.js';
import { COMMUNITY_MOD, evaluateReport, moderationEligibility } from '../services/community-moderation.js';

const communityModerationRoutes: FastifyPluginAsync = async app => {
  app.get('/community-mod/status', { preHandler: authenticate }, async req => ({
    ...(await moderationEligibility(req.authUser!.id)),
    rules: COMMUNITY_MOD,
  }));

  // Fila: denúncias abertas que o usuário ainda não votou, excluindo as dele e as sobre ele.
  app.get('/community-mod/queue', { preHandler: authenticate }, async (req, reply) => {
    const status = await moderationEligibility(req.authUser!.id);
    if (!status.eligible)
      return reply.code(403).send({ error: 'Você ainda não pode participar da triagem.', reasons: status.reasons });
    const userId = req.authUser!.id;
    const reports = await prisma.commentReport.findMany({
      where: {
        status: 'OPEN',
        reporterId: { not: userId },
        comment: { userId: { not: userId }, hiddenAt: null },
        votes: { none: { userId } },
      },
      select: {
        id: true,
        reason: true,
        details: true,
        createdAt: true,
        comment: {
          select: { id: true, content: true, createdAt: true, post: { select: { title: true, slug: true } } },
        },
        _count: { select: { votes: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    // O autor do comentário não é exibido: a triagem avalia o conteúdo, não a pessoa.
    return { items: reports, weight: status.weight, reputation: status.reputation };
  });

  app.post(
    '/community-mod/reports/:id/vote',
    { preHandler: authenticate, config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
      const { verdict } = z.object({ verdict: z.enum(['VIOLATES', 'OK']) }).parse(req.body);
      const status = await moderationEligibility(req.authUser!.id);
      if (!status.eligible) return reply.code(403).send({ error: 'Você ainda não pode participar da triagem.' });
      const report = await prisma.commentReport.findUnique({
        where: { id },
        select: { status: true, reporterId: true, comment: { select: { userId: true } } },
      });
      if (!report || report.status !== 'OPEN') return reply.code(404).send({ error: 'Denúncia não está mais aberta.' });
      if (report.reporterId === req.authUser!.id || report.comment.userId === req.authUser!.id)
        return reply.code(403).send({ error: 'Você não pode votar nesta denúncia.' });
      try {
        await prisma.reportVote.create({
          data: { reportId: id, userId: req.authUser!.id, verdict, weight: status.weight },
        });
      } catch {
        return reply.code(409).send({ error: 'Você já votou nesta denúncia.' });
      }
      return evaluateReport(id);
    },
  );
};
export default communityModerationRoutes;
