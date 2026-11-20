import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate } from '../lib/auth.js';
import { isManagedUploadUrl } from '../lib/managed-upload.js';
import { assertVerifiedEmail } from '../lib/verified-email.js';
const REACTIONS = ['LIKE', 'LOVE', 'HAHA', 'WOW', 'SAD', 'ANGRY', 'FIRE'] as const;
import { addXp, unlock, XP_RULES } from '../services/gamification.js';
import { notify, notifyFollowersActivity } from '../services/notifications.js';
const communityRoutes: FastifyPluginAsync = async app => {
  app.get('/community/feed', async req => {
    const q = z
      .object({ cursor: z.string().optional(), limit: z.coerce.number().min(1).max(30).default(15) })
      .parse(req.query);
    const items = await prisma.communityPost.findMany({
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } },
        _count: { select: { comments: true, reactions: true } },
        reactions: { take: 5, select: { kind: true, userId: true } },
      },
    });
    const hasMore = items.length > q.limit;
    if (hasMore) items.pop();
    let viewerId: string | undefined;
    try {
      const payload = await req.jwtVerify<{ sub: string }>();
      viewerId = payload.sub;
    } catch {}
    let following = new Set<string>();
    if (viewerId) {
      const userIds = [...new Set(items.map(p => p.userId).filter(id => id !== viewerId))];
      if (userIds.length) {
        const rows = await prisma.userFollow.findMany({
          where: { followerId: viewerId, followingId: { in: userIds } },
          select: { followingId: true },
        });
        following = new Set(rows.map(r => r.followingId));
      }
    }
    return {
      items: items.map(item => ({ ...item, viewerFollowing: following.has(item.userId) })),
      nextCursor: hasMore ? items.at(-1)?.id : null,
    };
  });
  app.post(
    '/community/posts',
    { preHandler: authenticate, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      await assertVerifiedEmail(req.authUser!.id);
      const b = z
        .object({ content: z.string().trim().min(1).max(5000), imageUrl: z.string().url().optional().nullable() })
        .parse(req.body);
      if (b.imageUrl && !isManagedUploadUrl(b.imageUrl, ['community']))
        return reply.code(400).send({ error: 'A imagem deve ser enviada pelo upload seguro do Hypeverso.' });
      const post = await prisma.communityPost.create({
        data: { userId: req.authUser!.id, content: b.content, imageUrl: b.imageUrl || null },
        include: {
          user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } },
          _count: { select: { comments: true, reactions: true } },
        },
      });
      await Promise.all([
        addXp(req.authUser!.id, XP_RULES.COMMUNITY_POST_CREATED),
        unlock(req.authUser!.id, 'FIRST_POST'),
        notifyFollowersActivity({
          actorId: req.authUser!.id,
          title: `${post.user.name} publicou na comunidade`,
          body: b.content.slice(0, 160),
          entityType: 'communityPost',
          entityId: post.id,
        }).catch(() => 0),
      ]);
      return reply.code(201).send({ ...post, viewerFollowing: false });
    },
  );
  app.delete('/community/posts/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const post = await prisma.communityPost.findUnique({ where: { id } });
    if (!post) return reply.code(404).send({ error: 'Publicação não encontrada' });
    if (post.userId !== req.authUser!.id && req.authUser!.role !== 'ADMIN' && req.authUser!.role !== 'MODERATOR')
      return reply.code(403).send({ error: 'Acesso negado' });
    await prisma.communityPost.delete({ where: { id } });
    return reply.code(204).send();
  });
  app.post(
    '/community/posts/:id/react',
    { preHandler: authenticate, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const { kind } = z.object({ kind: z.enum(REACTIONS).default('LIKE') }).parse(req.body ?? {});
      if (!(await prisma.communityPost.findUnique({ where: { id }, select: { id: true } })))
        return reply.code(404).send({ error: 'Publicação não encontrada' });
      const key = { communityPostId_userId: { communityPostId: id, userId: req.authUser!.id } };
      const existing = await prisma.communityReaction.findUnique({ where: key });
      if (existing) {
        if (existing.kind === kind) {
          await prisma.communityReaction.delete({ where: key });
          return { reacted: false };
        }
        await prisma.communityReaction.update({ where: key, data: { kind } });
      } else await prisma.communityReaction.create({ data: { communityPostId: id, userId: req.authUser!.id, kind } });
      const [post, actor] = await Promise.all([
        prisma.communityPost.findUnique({ where: { id }, select: { userId: true } }),
        prisma.user.findUnique({ where: { id: req.authUser!.id }, select: { name: true } }),
      ]);
      await Promise.all([
        post
          ? notify({
              recipientId: post.userId,
              actorId: req.authUser!.id,
              type: 'REACTION',
              title: 'Reagiram à sua publicação',
              entityType: 'communityPost',
              entityId: id,
            }).catch(() => undefined)
          : Promise.resolve(),
        notifyFollowersActivity({
          actorId: req.authUser!.id,
          title: `${actor?.name || 'Alguém que você segue'} reagiu a uma publicação`,
          entityType: 'communityPost',
          entityId: id,
        }).catch(() => 0),
      ]);
      return { reacted: true, kind };
    },
  );
  app.get('/community/posts/:id/comments', async req => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return prisma.communityComment.findMany({
      take: 200,
      where: { communityPostId: id },
      include: { user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } } },
      orderBy: { createdAt: 'asc' },
    });
  });
  app.post(
    '/community/posts/:id/comments',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      await assertVerifiedEmail(req.authUser!.id);
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const { content } = z.object({ content: z.string().trim().min(1).max(2000) }).parse(req.body);
      const c = await prisma.communityComment.create({
        data: { communityPostId: id, userId: req.authUser!.id, content },
        include: { user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } } },
      });
      const post = await prisma.communityPost.findUnique({ where: { id }, select: { userId: true } });
      await Promise.all([
        post
          ? notify({
              recipientId: post.userId,
              actorId: req.authUser!.id,
              type: 'COMMENT',
              title: 'Novo comentário na comunidade',
              body: content.slice(0, 140),
              entityType: 'communityPost',
              entityId: id,
            }).catch(() => undefined)
          : Promise.resolve(),
        notifyFollowersActivity({
          actorId: req.authUser!.id,
          title: `${c.user.name} comentou na comunidade`,
          body: content.slice(0, 160),
          entityType: 'communityPost',
          entityId: id,
        }).catch(() => 0),
      ]);
      return reply.code(201).send(c);
    },
  );
};
export default communityRoutes;
