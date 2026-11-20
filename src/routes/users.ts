import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, clearAuthCookies, verifyPassword } from '../lib/auth.js';
import { notify } from '../services/notifications.js';
import { isManagedUploadUrl } from '../lib/managed-upload.js';
const usersRoutes: FastifyPluginAsync = async app => {
  app.get('/me', { preHandler: authenticate }, async req =>
    prisma.user
      .findUnique({
        where: { id: req.authUser!.id },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          avatarUrl: true,
          bio: true,
          level: true,
          xp: true,
          role: true,
          emailVerifiedAt: true,
          createdAt: true,
          subscription: true,
          totpEnabledAt: true,
          moderationReputation: true,
          _count: { select: { followers: true, following: true, favorites: true, comments: true } },
        },
      })
      .then(user => {
        if (!user) return user;
        const { totpEnabledAt, ...rest } = user;
        const premium =
          user.subscription?.status === 'ACTIVE' &&
          (!user.subscription.currentPeriodEnd || user.subscription.currentPeriodEnd > new Date());
        return { ...rest, mfaEnabled: Boolean(totpEnabledAt), isPremium: premium };
      }),
  );
  app.patch('/me', { preHandler: authenticate }, async (req, reply) => {
    const b = z
      .object({
        name: z.string().trim().min(2).max(100).optional(),
        bio: z.string().max(600).optional().nullable(),
        avatarUrl: z.string().url().optional().nullable(),
      })
      .parse(req.body);
    if (b.avatarUrl !== undefined && !isManagedUploadUrl(b.avatarUrl, ['avatar']))
      return reply.code(400).send({ error: 'O avatar deve ser enviado pelo upload seguro do Hypeverso.' });
    return prisma.user.update({
      where: { id: req.authUser!.id },
      data: b,
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        avatarUrl: true,
        bio: true,
        level: true,
        xp: true,
        role: true,
      },
    });
  });

  app.get('/me/news-preferences', { preHandler: authenticate }, async req => {
    const [categories, selected] = await Promise.all([
      prisma.category.findMany({ select: { id: true, name: true, slug: true, icon: true }, orderBy: { name: 'asc' } }),
      prisma.userNewsCategoryPreference.findMany({ where: { userId: req.authUser!.id }, select: { categoryId: true } }),
    ]);
    const selectedIds = new Set(selected.map(row => row.categoryId));
    return {
      categories: categories.map(c => ({ ...c, enabled: selectedIds.has(c.id) })),
      selectedCategoryIds: [...selectedIds],
    };
  });

  app.put('/me/news-preferences', { preHandler: authenticate }, async req => {
    const { categoryIds } = z.object({ categoryIds: z.array(z.string()).max(100) }).parse(req.body);
    const unique = [...new Set(categoryIds)];
    if (unique.length) {
      const valid = await prisma.category.count({ where: { id: { in: unique } } });
      if (valid !== unique.length) {
        const error = new Error('Uma ou mais categorias selecionadas não existem.') as Error & { statusCode: number };
        error.statusCode = 400;
        throw error;
      }
    }
    await prisma.$transaction([
      prisma.userNewsCategoryPreference.deleteMany({ where: { userId: req.authUser!.id } }),
      ...(unique.length
        ? [
            prisma.userNewsCategoryPreference.createMany({
              data: unique.map(categoryId => ({ userId: req.authUser!.id, categoryId })),
            }),
          ]
        : []),
    ]);
    return { ok: true, selectedCategoryIds: unique };
  });

  // LGPD art. 18: portabilidade/acesso. Exporta os dados pessoais do titular em JSON.
  app.get(
    '/me/export',
    { preHandler: authenticate, config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const id = req.authUser!.id;
      const data = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          avatarUrl: true,
          bio: true,
          level: true,
          xp: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
          termsAcceptedAt: true,
          termsVersion: true,
          createdAt: true,
          updatedAt: true,
          subscription: { select: { status: true, currentPeriodEnd: true, createdAt: true } },
          comments: { select: { id: true, postId: true, content: true, createdAt: true } },
          communityPosts: { select: { id: true, content: true, imageUrl: true, createdAt: true } },
          communityComments: { select: { id: true, communityPostId: true, content: true, createdAt: true } },
          favorites: { select: { postId: true, createdAt: true } },
          library: {
            select: {
              externalId: true,
              title: true,
              mediaType: true,
              status: true,
              notes: true,
              rating: true,
              createdAt: true,
            },
          },
          following: { select: { followingId: true, createdAt: true } },
          searchHistory: { select: { query: true, createdAt: true } },
          newsPreferences: { select: { categoryId: true } },
          achievements: { select: { achievement: { select: { name: true } }, unlockedAt: true } },
        },
      });
      reply.header('cache-control', 'no-store');
      reply.header(
        'content-disposition',
        `attachment; filename="hypeverso-meus-dados-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      return { exportedAt: new Date().toISOString(), data };
    },
  );

  // LGPD art. 18, VI: eliminação. Exige senha para impedir exclusão via sessão roubada.
  app.delete(
    '/me',
    { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { password, confirm } = z
        .object({ password: z.string().min(1).max(128), confirm: z.literal('EXCLUIR') })
        .parse(req.body);
      const user = await prisma.user.findUnique({
        where: { id: req.authUser!.id },
        select: {
          id: true,
          passwordHash: true,
          subscription: { select: { status: true } },
          _count: { select: { posts: true } },
        },
      });
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' });
      if (!(await verifyPassword(user.passwordHash, password)))
        return reply.code(403).send({ error: 'Senha incorreta' });
      if (user.subscription?.status === 'ACTIVE' || user.subscription?.status === 'PAST_DUE')
        return reply.code(409).send({ error: 'Cancele a assinatura Premium antes de excluir a conta.' });
      if (user._count.posts > 0)
        return reply.code(409).send({
          error:
            'Contas com artigos publicados precisam ser removidas por um administrador (os artigos devem ser transferidos antes).',
        });
      await prisma.user.delete({ where: { id: user.id } });
      clearAuthCookies(reply);
      return reply.code(204).send();
    },
  );

  app.get('/rankings', async () =>
    prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        username: true,
        avatarUrl: true,
        level: true,
        xp: true,
        achievements: { select: { achievement: { select: { name: true, icon: true } } } },
      },
      orderBy: [{ xp: 'desc' }, { createdAt: 'asc' }],
      take: 100,
    }),
  );
  app.get('/me/history', { preHandler: authenticate }, async req =>
    prisma.userInteraction.findMany({
      where: { userId: req.authUser!.id, type: 'VIEW' },
      distinct: ['postId'],
      include: {
        post: {
          select: {
            id: true,
            title: true,
            slug: true,
            description: true,
            coverImageUrl: true,
            category: { select: { name: true, slug: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  );
  app.get('/users/:username', async (req, reply) => {
    const { username } = z.object({ username: z.string() }).parse(req.params);
    const u = await prisma.user.findFirst({
      where: { username, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        username: true,
        avatarUrl: true,
        bio: true,
        level: true,
        xp: true,
        createdAt: true,
        _count: { select: { followers: true, following: true, comments: true, favorites: true } },
        achievements: { include: { achievement: true } },
        communityPosts: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { comments: true, reactions: true } } },
        },
        subscription: { select: { status: true } },
      },
    });
    if (!u) return reply.code(404).send({ error: 'Usuário não encontrado' });
    return u;
  });

  app.get('/users/:id/follow-status', { preHandler: authenticate }, async req => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    if (id === req.authUser!.id) return { following: false, self: true };
    const row = await prisma.userFollow.findUnique({
      where: { followerId_followingId: { followerId: req.authUser!.id, followingId: id } },
      select: { followerId: true },
    });
    return { following: !!row, self: false };
  });

  app.post(
    '/users/:id/follow',
    { preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      if (id === req.authUser!.id) return reply.code(400).send({ error: 'Você não pode seguir a si mesmo' });
      const target = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!target || target.status !== 'ACTIVE') return reply.code(404).send({ error: 'Usuário não encontrado' });
      const key = { followerId_followingId: { followerId: req.authUser!.id, followingId: id } };
      const existing = await prisma.userFollow.findUnique({ where: key });
      if (existing) {
        await prisma.userFollow.delete({ where: key });
        return { following: false };
      }
      await prisma.userFollow.create({ data: { followerId: req.authUser!.id, followingId: id } });
      await notify({
        recipientId: id,
        actorId: req.authUser!.id,
        type: 'FOLLOW',
        title: 'Novo seguidor',
        entityType: 'user',
        entityId: req.authUser!.id,
      }).catch(() => undefined);
      return { following: true };
    },
  );

  app.get('/notifications', { preHandler: authenticate }, async req =>
    prisma.notification.findMany({
      where: { recipientId: req.authUser!.id },
      include: { actor: { select: { id: true, name: true, username: true, avatarUrl: true } } },
      take: 100,
      orderBy: { createdAt: 'desc' },
    }),
  );
  app.get('/notifications/unread-count', { preHandler: authenticate }, async req => ({
    count: await prisma.notification.count({ where: { recipientId: req.authUser!.id, readAt: null } }),
  }));
  app.post('/notifications/read', { preHandler: authenticate }, async req => {
    const { ids } = z.object({ ids: z.array(z.string()).max(200).optional() }).parse(req.body ?? {});
    await prisma.notification.updateMany({
      where: { recipientId: req.authUser!.id, ...(ids?.length ? { id: { in: ids } } : { readAt: null }) },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
};
export default usersRoutes;
