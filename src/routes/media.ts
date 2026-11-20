import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRole } from '../lib/auth.js';
import { setModeration } from '../services/media-moderation.js';

/** Fila de moderação de imagens de usuários (revisão manual no CMS). */
const mediaRoutes: FastifyPluginAsync = async app => {
  const moderator = async (req: any, reply: any) => requireRole('MODERATOR', 'EDITOR', 'ADMIN')(req, reply);

  app.get('/admin/media/moderation', { preHandler: moderator }, async req => {
    const { status } = z
      .object({ status: z.enum(['PENDING', 'REJECTED', 'APPROVED']).default('PENDING') })
      .parse(req.query ?? {});
    const [counts, items] = await Promise.all([
      prisma.mediaAsset.groupBy({ by: ['moderationStatus'], _count: { _all: true } }),
      prisma.mediaAsset.findMany({
        where: { moderationStatus: status },
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: {
          id: true,
          name: true,
          purpose: true,
          createdAt: true,
          moderatedAt: true,
          moderationScore: true,
          uploadedById: true,
        },
      }),
    ]);
    const users = await prisma.user.findMany({
      where: { id: { in: items.map(i => i.uploadedById).filter((v): v is string => Boolean(v)) } },
      select: { id: true, name: true, username: true },
    });
    const byUser = new Map(users.map(u => [u.id, u]));
    return {
      counts: Object.fromEntries(counts.map(c => [c.moderationStatus, c._count._all])),
      items: items.map(i => ({ ...i, uploadedBy: i.uploadedById ? byUser.get(i.uploadedById) || null : null })),
    };
  });

  // Imagem original (mesmo pendente/recusada) só para a equipe revisar.
  app.get('/admin/media/:id/raw', { preHandler: moderator }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const asset = await prisma.mediaAsset.findUnique({ where: { id }, select: { data: true, mimeType: true } });
    if (!asset) return reply.code(404).send({ error: 'Imagem não encontrada' });
    return reply
      .header('content-type', asset.mimeType)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(asset.data as any));
  });

  app.post('/admin/media/:id/:decision', { preHandler: moderator }, async req => {
    const { id, decision } = z
      .object({ id: z.string().min(1).max(40), decision: z.enum(['approve', 'reject']) })
      .parse(req.params);
    await setModeration(id, decision === 'approve' ? 'APPROVED' : 'REJECTED');
    return { ok: true };
  });
};
export default mediaRoutes;
