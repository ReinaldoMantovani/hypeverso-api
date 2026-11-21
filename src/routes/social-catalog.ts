import { CATALOG_PROVIDERS } from '../services/media-catalog.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, optionalUser } from '../lib/auth.js';
import { assertVerifiedEmail } from '../lib/verified-email.js';
import { slugify } from '../lib/security.js';
import { redis } from '../lib/redis.js';
import { catalogCardSelect, catalogRefSchema, resolveCatalogItem } from '../lib/catalog-ref.js';
import { getWatchProviders, mediaTypes } from '../services/media-catalog.js';
import { viewerKey } from '../services/views.js';
import { clientIp } from '../lib/client-ip.js';

const userCard = { id: true, name: true, username: true, avatarUrl: true, level: true } as const;
const isStaff = (role?: string) => role === 'ADMIN' || role === 'MODERATOR';
function httpError(message: string, statusCode: number, code?: string) {
  const e = new Error(message) as Error & { statusCode: number; code?: string };
  e.statusCode = statusCode;
  e.code = code;
  return e;
}

// Reviews do catálogo, threads de episódio/watch parties, listas públicas e "onde assistir".
const socialCatalogRoutes: FastifyPluginAsync = async app => {
  // ---------------- Reviews ----------------
  app.get('/catalog/items/:id/reviews', async req => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const { page } = z.object({ page: z.coerce.number().int().min(1).max(500).default(1) }).parse(req.query);
    const viewer = await optionalUser(req);
    const where = { catalogItemId: id, hiddenAt: null };
    const [agg, groups, items, mine] = await Promise.all([
      prisma.catalogReview.aggregate({ where, _avg: { rating: true }, _count: { _all: true } }),
      prisma.catalogReview.groupBy({ by: ['rating'], where, _count: { _all: true } }),
      prisma.catalogReview.findMany({
        where,
        include: { user: { select: userCard } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 20,
        take: 20,
      }),
      viewer
        ? prisma.catalogReview.findUnique({ where: { catalogItemId_userId: { catalogItemId: id, userId: viewer.id } } })
        : null,
    ]);
    const distribution = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 0]));
    for (const g of groups) distribution[g.rating] = g._count._all;
    return {
      summary: {
        average: agg._avg.rating ? Number(agg._avg.rating.toFixed(1)) : null,
        count: agg._count._all,
        distribution,
      },
      items,
      viewerReview: mine,
      page,
    };
  });

  app.put(
    '/catalog/items/:id/reviews',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async req => {
      const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
      const body = z
        .object({
          rating: z.number().int().min(1).max(10),
          title: z.string().trim().max(120).optional().nullable(),
          body: z.string().trim().max(5000).optional().nullable(),
          spoiler: z.boolean().default(false),
        })
        .parse(req.body);
      await assertVerifiedEmail(req.authUser!.id);
      const item = await prisma.mediaCatalogItem.findUnique({ where: { id }, select: { id: true } });
      if (!item) throw httpError('Item do catálogo não encontrado', 404);
      const data = { rating: body.rating, title: body.title || null, body: body.body || null, spoiler: body.spoiler };
      return prisma.catalogReview.upsert({
        where: { catalogItemId_userId: { catalogItemId: id, userId: req.authUser!.id } },
        create: { catalogItemId: id, userId: req.authUser!.id, ...data },
        update: data,
        include: { user: { select: userCard } },
      });
    },
  );

  app.delete('/catalog/items/:id/reviews', { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    await prisma.catalogReview.deleteMany({ where: { catalogItemId: id, userId: req.authUser!.id } });
    return reply.code(204).send();
  });

  app.delete('/reviews/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const review = await prisma.catalogReview.findUnique({ where: { id }, select: { userId: true } });
    if (!review) return reply.code(404).send({ error: 'Avaliação não encontrada' });
    if (review.userId !== req.authUser!.id && !isStaff(req.authUser!.role))
      return reply.code(403).send({ error: 'Acesso negado' });
    if (review.userId === req.authUser!.id) await prisma.catalogReview.delete({ where: { id } });
    else await prisma.catalogReview.update({ where: { id }, data: { hiddenAt: new Date() } });
    return reply.code(204).send();
  });

  // ---------------- Onde assistir ----------------
  app.get(
    '/catalog/:provider/:type/:externalId/watch-providers',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { provider, type, externalId } = z
        .object({
          provider: z.enum(CATALOG_PROVIDERS),
          type: z.enum(mediaTypes),
          externalId: z.string().min(1).max(120),
        })
        .parse(req.params);
      const { region } = z
        .object({
          region: z
            .string()
            .regex(/^[A-Z]{2}$/)
            .optional(),
        })
        .parse(req.query);
      const data = await getWatchProviders(provider, type, externalId, region);
      reply.header('cache-control', 'public, max-age=3600');
      return { available: !!data, providers: data, attribution: 'JustWatch' };
    },
  );

  // ---------------- Threads de episódio / watch parties ----------------
  const threadSelect = {
    id: true,
    kind: true,
    title: true,
    description: true,
    season: true,
    episode: true,
    startsAt: true,
    lockedAt: true,
    lastMessageAt: true,
    createdAt: true,
    createdBy: { select: userCard },
    catalogItem: { select: catalogCardSelect },
    _count: { select: { messages: true } },
  } as const;

  app.get('/catalog/items/:id/threads', async req => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    return prisma.discussionThread.findMany({
      where: { catalogItemId: id },
      select: threadSelect,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 50,
    });
  });

  app.get('/threads', async req => {
    const q = z
      .object({
        kind: z.enum(['EPISODE', 'WATCH_PARTY', 'GENERAL']).optional(),
        upcoming: z.enum(['1', 'true']).optional(),
      })
      .parse(req.query);
    return prisma.discussionThread.findMany({
      where: {
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.upcoming ? { startsAt: { gte: new Date(Date.now() - 3 * 3600000) } } : {}),
      },
      select: threadSelect,
      orderBy: q.upcoming ? { startsAt: 'asc' } : { createdAt: 'desc' },
      take: 50,
    });
  });

  app.post(
    '/threads',
    { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = z
        .object({
          catalogItemId: z.string().min(1).max(40).optional().nullable(),
          kind: z.enum(['EPISODE', 'WATCH_PARTY', 'GENERAL']).default('GENERAL'),
          title: z.string().trim().min(3).max(160),
          description: z.string().trim().max(2000).optional().nullable(),
          season: z.number().int().min(0).max(200).optional().nullable(),
          episode: z.number().int().min(0).max(5000).optional().nullable(),
          startsAt: z.string().datetime().optional().nullable(),
        })
        .parse(req.body);
      await assertVerifiedEmail(req.authUser!.id);
      if (body.kind === 'WATCH_PARTY' && (!body.startsAt || new Date(body.startsAt) < new Date(Date.now() - 60000)))
        return reply.code(400).send({ error: 'Informe uma data futura para a watch party.' });
      if (
        body.catalogItemId &&
        !(await prisma.mediaCatalogItem.findUnique({ where: { id: body.catalogItemId }, select: { id: true } }))
      )
        return reply.code(404).send({ error: 'Item do catálogo não encontrado' });
      const thread = await prisma.discussionThread.create({
        data: {
          catalogItemId: body.catalogItemId || null,
          kind: body.kind,
          title: body.title,
          description: body.description || null,
          season: body.season ?? null,
          episode: body.episode ?? null,
          startsAt: body.startsAt ? new Date(body.startsAt) : null,
          createdById: req.authUser!.id,
        },
        select: threadSelect,
      });
      return reply.code(201).send(thread);
    },
  );

  app.get('/threads/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const thread = await prisma.discussionThread.findUnique({ where: { id }, select: threadSelect });
    if (!thread) return reply.code(404).send({ error: 'Discussão não encontrada' });
    return thread;
  });

  // Polling incremental: ?after=<ISO> devolve só mensagens novas (usado no "ao vivo").
  app.get('/threads/:id/messages', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async req => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const q = z.object({ after: z.string().datetime().optional() }).parse(req.query);
    const rows = await prisma.threadMessage.findMany({
      where: { threadId: id, ...(q.after ? { createdAt: { gt: new Date(q.after) } } : {}) },
      include: { user: { select: userCard } },
      orderBy: { createdAt: q.after ? 'asc' : 'desc' },
      take: q.after ? 200 : 100,
    });
    const items = q.after ? rows : rows.reverse();
    return items.map(m => (m.hiddenAt ? { ...m, content: '', hidden: true } : { ...m, hidden: false }));
  });

  app.post(
    '/threads/:id/messages',
    { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
      const body = z
        .object({ content: z.string().trim().min(1).max(2000), spoiler: z.boolean().default(false) })
        .parse(req.body);
      await assertVerifiedEmail(req.authUser!.id);
      const thread = await prisma.discussionThread.findUnique({ where: { id }, select: { id: true, lockedAt: true } });
      if (!thread) return reply.code(404).send({ error: 'Discussão não encontrada' });
      if (thread.lockedAt) return reply.code(423).send({ error: 'Esta discussão está trancada.' });
      const [message] = await prisma.$transaction([
        prisma.threadMessage.create({
          data: { threadId: id, userId: req.authUser!.id, content: body.content, spoiler: body.spoiler },
          include: { user: { select: userCard } },
        }),
        prisma.discussionThread.update({ where: { id }, data: { lastMessageAt: new Date() } }),
      ]);
      return reply.code(201).send({ ...message, hidden: false });
    },
  );

  app.delete('/threads/messages/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const msg = await prisma.threadMessage.findUnique({ where: { id }, select: { userId: true } });
    if (!msg) return reply.code(404).send({ error: 'Mensagem não encontrada' });
    if (msg.userId !== req.authUser!.id && !isStaff(req.authUser!.role))
      return reply.code(403).send({ error: 'Acesso negado' });
    await prisma.threadMessage.update({ where: { id }, data: { hiddenAt: new Date() } });
    return reply.code(204).send();
  });

  app.patch('/threads/:id/lock', { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const { locked } = z.object({ locked: z.boolean() }).parse(req.body);
    const thread = await prisma.discussionThread.findUnique({ where: { id }, select: { createdById: true } });
    if (!thread) return reply.code(404).send({ error: 'Discussão não encontrada' });
    if (thread.createdById !== req.authUser!.id && !isStaff(req.authUser!.role))
      return reply.code(403).send({ error: 'Acesso negado' });
    return prisma.discussionThread.update({
      where: { id },
      data: { lockedAt: locked ? new Date() : null },
      select: threadSelect,
    });
  });

  // ---------------- Listas públicas ----------------
  const listSelect = {
    id: true,
    title: true,
    slug: true,
    description: true,
    isPublic: true,
    viewCount: true,
    createdAt: true,
    updatedAt: true,
    user: { select: userCard },
    _count: { select: { items: true } },
    items: {
      take: 4,
      orderBy: { position: 'asc' as const },
      select: { catalogItem: { select: { coverUrl: true, title: true } } },
    },
  } as const;

  async function uniqueListSlug(userId: string, title: string, currentId?: string) {
    const base = slugify(title).slice(0, 80) || 'lista';
    for (let i = 0; i < 50; i++) {
      const slug = i ? `${base}-${i + 1}` : base;
      const row = await prisma.userList.findUnique({ where: { userId_slug: { userId, slug } }, select: { id: true } });
      if (!row || row.id === currentId) return slug;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  async function ownedList(id: string, userId: string) {
    const list = await prisma.userList.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!list) throw httpError('Lista não encontrada', 404);
    if (list.userId !== userId) throw httpError('Acesso negado', 403);
    return list;
  }

  app.get('/lists', async req => {
    const q = z
      .object({
        sort: z.enum(['recent', 'popular']).default('recent'),
        page: z.coerce.number().int().min(1).max(200).default(1),
      })
      .parse(req.query);
    const where = { isPublic: true, items: { some: {} } };
    const [items, total] = await Promise.all([
      prisma.userList.findMany({
        where,
        select: listSelect,
        orderBy: q.sort === 'popular' ? [{ viewCount: 'desc' }, { updatedAt: 'desc' }] : { updatedAt: 'desc' },
        skip: (q.page - 1) * 24,
        take: 24,
      }),
      prisma.userList.count({ where }),
    ]);
    return { items, total, page: q.page, pages: Math.max(1, Math.ceil(total / 24)) };
  });

  app.get('/sitemap/lists', async (_req, reply) => {
    const items = await prisma.userList.findMany({
      where: { isPublic: true, items: { some: {} } },
      select: { id: true, slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    });
    reply.header('cache-control', 'public, max-age=900');
    return { items };
  });

  app.get('/lists/mine', { preHandler: authenticate }, async req =>
    prisma.userList.findMany({
      where: { userId: req.authUser!.id },
      select: listSelect,
      orderBy: { updatedAt: 'desc' },
    }),
  );

  app.get('/users/:username/lists', async req => {
    const { username } = z.object({ username: z.string().max(40) }).parse(req.params);
    return prisma.userList.findMany({
      where: { isPublic: true, user: { username, status: 'ACTIVE' } },
      select: listSelect,
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  });

  app.get('/lists/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const viewer = await optionalUser(req);
    const list = await prisma.userList.findUnique({
      where: { id },
      select: {
        ...listSelect,
        userId: true,
        items: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            note: true,
            position: true,
            catalogItem: { select: { ...catalogCardSelect, description: true, rating: true } },
          },
        },
      },
    });
    if (!list || (!list.isPublic && list.userId !== viewer?.id))
      return reply.code(404).send({ error: 'Lista não encontrada' });
    const { userId, ...rest } = list;
    return { ...rest, isOwner: userId === viewer?.id };
  });

  // Visualização real (disparada pelo navegador); deduplicada por visitante/dia.
  app.post('/lists/:id/view', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async req => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const viewer = await optionalUser(req);
    const key = `list:seen:${id}:${viewerKey(viewer?.id, clientIp(req), String(req.headers['user-agent'] || ''))}`;
    const fresh = await redis.set(key, '1', 'EX', 86400, 'NX').catch(() => null);
    if (fresh)
      await prisma.userList.updateMany({
        where: { id, isPublic: true, NOT: { userId: viewer?.id ?? '' } },
        data: { viewCount: { increment: 1 } },
      });
    return { ok: true };
  });

  const listBody = z.object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(1000).optional().nullable(),
    isPublic: z.boolean().default(true),
  });

  app.post(
    '/lists',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = listBody.parse(req.body);
      if (body.isPublic) await assertVerifiedEmail(req.authUser!.id);
      const count = await prisma.userList.count({ where: { userId: req.authUser!.id } });
      if (count >= 100) return reply.code(400).send({ error: 'Limite de 100 listas atingido.' });
      const list = await prisma.userList.create({
        data: {
          userId: req.authUser!.id,
          title: body.title,
          description: body.description || null,
          isPublic: body.isPublic,
          slug: await uniqueListSlug(req.authUser!.id, body.title),
        },
        select: listSelect,
      });
      return reply.code(201).send(list);
    },
  );

  app.patch('/lists/:id', { preHandler: authenticate }, async req => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const body = listBody.partial().parse(req.body);
    await ownedList(id, req.authUser!.id);
    if (body.isPublic) await assertVerifiedEmail(req.authUser!.id);
    return prisma.userList.update({
      where: { id },
      data: {
        ...(body.title ? { title: body.title, slug: await uniqueListSlug(req.authUser!.id, body.title, id) } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}),
      },
      select: listSelect,
    });
  });

  app.delete('/lists/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    await ownedList(id, req.authUser!.id);
    await prisma.userList.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.post(
    '/lists/:id/items',
    { preHandler: authenticate, config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
      const body = z
        .intersection(catalogRefSchema, z.object({ note: z.string().trim().max(500).optional().nullable() }))
        .parse(req.body);
      await ownedList(id, req.authUser!.id);
      const total = await prisma.userListItem.count({ where: { listId: id } });
      if (total >= 500) return reply.code(400).send({ error: 'Uma lista pode ter até 500 itens.' });
      const item = await resolveCatalogItem(body);
      if (!item) return reply.code(404).send({ error: 'Item do catálogo não encontrado' });
      const row = await prisma.userListItem.upsert({
        where: { listId_catalogItemId: { listId: id, catalogItemId: item.id } },
        create: { listId: id, catalogItemId: item.id, position: total, note: body.note || null },
        update: { note: body.note ?? undefined },
        select: { id: true, position: true, note: true, catalogItem: { select: catalogCardSelect } },
      });
      await prisma.userList.update({ where: { id }, data: { updatedAt: new Date() } });
      return reply.code(201).send(row);
    },
  );

  app.delete('/lists/:id/items/:itemId', { preHandler: authenticate }, async (req, reply) => {
    const { id, itemId } = z
      .object({ id: z.string().min(1).max(40), itemId: z.string().min(1).max(40) })
      .parse(req.params);
    await ownedList(id, req.authUser!.id);
    await prisma.userListItem.deleteMany({ where: { id: itemId, listId: id } });
    return reply.code(204).send();
  });

  app.put('/lists/:id/order', { preHandler: authenticate }, async req => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const { itemIds } = z.object({ itemIds: z.array(z.string().min(1).max(40)).max(500) }).parse(req.body);
    await ownedList(id, req.authUser!.id);
    await prisma.$transaction(
      itemIds.map((itemId, position) =>
        prisma.userListItem.updateMany({ where: { id: itemId, listId: id }, data: { position } }),
      ),
    );
    return { ok: true };
  });
};
export default socialCatalogRoutes;
