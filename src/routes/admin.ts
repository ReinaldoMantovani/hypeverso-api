import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRole } from '../lib/auth.js';
import { applyStaffDecision } from '../services/community-moderation.js';
const adminRoutes: FastifyPluginAsync = async app => {
  const admin = async (req: any, reply: any) => requireRole('ADMIN')(req, reply);
  const moderation = async (req: any, reply: any) => requireRole('MODERATOR', 'ADMIN')(req, reply);
  app.get('/admin/dashboard', { preHandler: admin }, async () => {
    const since = new Date(Date.now() - 30 * 86400000);
    const [users, posts, published, comments, community, views, newUsers, premium, reports] = await prisma.$transaction(
      [
        prisma.user.count(),
        prisma.post.count(),
        prisma.post.count({ where: { status: 'PUBLISHED' } }),
        prisma.comment.count(),
        prisma.communityPost.count(),
        prisma.analyticsEvent.count({ where: { type: 'POST_VIEW', createdAt: { gte: since } } }),
        prisma.user.count({ where: { createdAt: { gte: since } } }),
        prisma.subscription.count({ where: { status: 'ACTIVE' } }),
        prisma.commentReport.count({ where: { status: 'OPEN' } }),
      ],
    );
    // Agrupamento por dia feito em JS: funciona igual em MySQL/MariaDB (sem SQL específico).
    const recentUsers = await prisma.user.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
      take: 100_000,
    });
    const perDay = new Map<string, number>();
    for (const u of recentUsers) {
      const day = u.createdAt.toISOString().slice(0, 10);
      perDay.set(day, (perDay.get(day) || 0) + 1);
    }
    const growth = [...perDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, count]) => ({ day: new Date(`${day}T00:00:00.000Z`), count }));
    return {
      totals: { users, posts, published, comments, community, premium, reports },
      last30Days: { views, newUsers, userGrowth: growth.map(r => ({ day: r.day, count: Number(r.count) })) },
    };
  });
  app.get('/admin/users', { preHandler: admin }, async req => {
    const q = z
      .object({
        q: z.string().max(100).optional(),
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(30),
      })
      .parse(req.query);
    return prisma.user.findMany({
      where: q.q
        ? {
            OR: [
              { name: { contains: q.q } },
              { email: { contains: q.q } },
              { username: { contains: q.q } },
            ],
          }
        : undefined,
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        status: true,
        level: true,
        xp: true,
        createdAt: true,
        subscription: true,
      },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: 'desc' },
    });
  });
  app.patch('/admin/users/:id', { preHandler: admin }, async req => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z
      .object({
        role: z.enum(['USER', 'MODERATOR', 'EDITOR', 'ADMIN']).optional(),
        status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']).optional(),
      })
      .parse(req.body);
    if (id === req.authUser!.id && ((b.role && b.role !== 'ADMIN') || (b.status && b.status !== 'ACTIVE'))) {
      const e: any = new Error('Você não pode rebaixar ou bloquear a própria conta.');
      e.statusCode = 400;
      throw e;
    }
    if (b.role && b.role !== 'ADMIN') {
      const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
      if (target?.role === 'ADMIN' && (await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })) <= 1) {
        const e: any = new Error('O sistema precisa manter ao menos um administrador ativo.');
        e.statusCode = 400;
        throw e;
      }
    }
    const updated = await prisma.user.update({
      where: { id },
      data: b,
      select: { id: true, name: true, username: true, email: true, role: true, status: true },
    });
    if ((b.status && b.status !== 'ACTIVE') || b.role) {
      await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    req.log.info({ adminId: req.authUser!.id, targetId: id, changes: b }, 'Admin alterou usuário');
    return updated;
  });
  app.get('/admin/reports', { preHandler: moderation }, async () => {
    const reports = await prisma.commentReport.findMany({
      include: {
        comment: {
          include: { user: { select: { name: true, username: true } }, post: { select: { title: true, slug: true } } },
        },
        reporter: { select: { name: true, username: true } },
        votes: { select: { verdict: true, weight: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    // Resumo da triagem comunitária para a decisão final da equipe.
    return reports.map(({ votes, ...r }) => ({
      ...r,
      community: {
        violates: votes.filter(v => v.verdict === 'VIOLATES').reduce((s, v) => s + v.weight, 0),
        ok: votes.filter(v => v.verdict === 'OK').reduce((s, v) => s + v.weight, 0),
        voters: votes.length,
      },
    }));
  });
  app.patch('/admin/reports/:id', { preHandler: moderation }, async req => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { status } = z.object({ status: z.enum(['REVIEWED', 'RESOLVED', 'DISMISSED']) }).parse(req.body);
    const report = await prisma.commentReport.update({ where: { id }, data: { status } });
    // Decisão final da equipe: aplica ao comentário e recalibra a reputação dos triadores.
    await applyStaffDecision(id, status, req.authUser!.id);
    return report;
  });
};
export default adminRoutes;
