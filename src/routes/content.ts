import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../lib/auth.js';
import { assertVerifiedEmail } from '../lib/verified-email.js';
import { recordPostView, viewerKey } from '../services/views.js';
import { delCache, getCache, setCache } from '../lib/redis.js';
import { slugify } from '../lib/security.js';
import { addXp, unlock, XP_RULES } from '../services/gamification.js';
import { notify, notifyFollowersActivity, notifyNewsPublished } from '../services/notifications.js';
import { removePostFromSearchIndex, syncPostToSearchIndex } from '../services/search-index.js';
import { bullEnabled, enqueueNewsPublished, enqueueSearchRemove, enqueueSearchSync } from '../lib/bullmq.js';
import { clientIp } from '../lib/client-ip.js';
import { localesForPosts, localizePost, localizePostList } from '../services/translation.js';
import { sanitizePostHtml } from '../lib/post-html.js';

const publicSelect = {
  id: true,
  viewCount: true,
  title: true,
  slug: true,
  description: true,
  coverImageUrl: true,
  isPremium: true,
  publishedAt: true,
  createdAt: true,
  category: { select: { id: true, name: true, slug: true } },
  author: { select: { id: true, name: true, username: true, avatarUrl: true } },
  tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
  _count: { select: { comments: true, favorites: true } },
} as const;

async function queuePostPublished(postId: string, log: any) {
  if (bullEnabled()) {
    await Promise.all([
      enqueueNewsPublished(postId).catch(error =>
        log.warn({ err: error, postId }, 'BullMQ: notificação ficará para reconciliação/manual'),
      ),
      enqueueSearchSync(postId).catch(error =>
        log.warn({ err: error, postId }, 'BullMQ: indexação ficará para o discovery-worker'),
      ),
    ]);
    return;
  }
  await notifyNewsPublished(postId).catch((error: any) =>
    log.error({ err: error, postId }, 'Notificação de notícia falhou'),
  );
  void syncPostToSearchIndex(postId).catch((error: any) =>
    log.warn({ err: error, postId }, 'Sincronização da busca falhou'),
  );
}

async function queuePostSearchSync(postId: string, log: any) {
  if (bullEnabled())
    await enqueueSearchSync(postId).catch(error =>
      log.warn({ err: error, postId }, 'BullMQ: indexação ficará para reconciliação'),
    );
  else
    void syncPostToSearchIndex(postId).catch((error: any) =>
      log.warn({ err: error, postId }, 'Sincronização da busca falhou'),
    );
}

async function queuePostSearchRemove(postId: string, log: any) {
  if (bullEnabled())
    await enqueueSearchRemove(postId).catch(error =>
      log.warn({ err: error, postId }, 'BullMQ: remoção do índice ficará para reconciliação'),
    );
  else
    void removePostFromSearchIndex(postId).catch((error: any) =>
      log.warn({ err: error, postId }, 'Remoção do índice falhou'),
    );
}
const CMS_BODY_LIMIT = 20 * 1024 * 1024;
// Somente players/embeds conhecidos podem aparecer em iframes de artigos. Isso
// impede que um conteúdo gerado/importado embuta páginas de phishing ou malware.
const contentRoutes: FastifyPluginAsync = async app => {
  app.get('/categories', async req => {
    const q = z.object({ fresh: z.enum(['1', 'true']).optional() }).parse(req.query);
    if (q.fresh) await delCache('categories');
    const c = await getCache<any>('categories');
    if (c) return c;
    const rows = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    await setCache('categories', rows, 3600);
    return rows;
  });
  // ---- Dados para sitemaps (index paginado + Google Notícias) ----
  const SITEMAP_PAGE = 5000;
  const publishedWhere = () => ({ status: 'PUBLISHED' as const, publishedAt: { lte: new Date() } });
  app.get('/sitemap/posts', async (req, reply) => {
    const { page } = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) }).parse(req.query);
    const [rawItems, total] = await Promise.all([
      prisma.post.findMany({
        where: publishedWhere(),
        select: { id: true, slug: true, updatedAt: true, publishedAt: true, coverImageUrl: true, title: true },
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * SITEMAP_PAGE,
        take: SITEMAP_PAGE,
      }),
      prisma.post.count({ where: publishedWhere() }),
    ]);
    reply.header('cache-control', 'public, max-age=300');
    // Idiomas traduzidos de cada artigo (hreflang no sitemap).
    const locales = await localesForPosts(rawItems.map(i => i.id));
    const items = rawItems.map(({ id, ...rest }) => ({ ...rest, locales: locales.get(id) || [] }));
    return { items, total, page, pages: Math.max(1, Math.ceil(total / SITEMAP_PAGE)), pageSize: SITEMAP_PAGE };
  });
  app.get('/sitemap/news', async (_req, reply) => {
    // Google Notícias: apenas artigos dos últimos 2 dias, no máximo 1000.
    const items = await prisma.post.findMany({
      where: { status: 'PUBLISHED', publishedAt: { lte: new Date(), gte: new Date(Date.now() - 2 * 86400000) } },
      select: { slug: true, title: true, publishedAt: true, tags: { select: { tag: { select: { name: true } } } } },
      orderBy: { publishedAt: 'desc' },
      take: 1000,
    });
    reply.header('cache-control', 'public, max-age=120');
    return { items };
  });
  app.get('/sitemap/taxonomies', async (_req, reply) => {
    const [categories, tags] = await Promise.all([
      prisma.category.findMany({ select: { slug: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.tag.findMany({
        where: { posts: { some: { post: publishedWhere() } } },
        select: { slug: true, name: true },
        orderBy: { name: 'asc' },
        take: 5000,
      }),
    ]);
    reply.header('cache-control', 'public, max-age=600');
    return { categories, tags };
  });
  app.get('/tags/:slug', async (req, reply) => {
    const { slug } = z.object({ slug: z.string().max(120) }).parse(req.params);
    const tag = await prisma.tag.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
    if (!tag) return reply.code(404).send({ error: 'Tag não encontrada' });
    return tag;
  });
  app.get('/categories/:slug', async (req, reply) => {
    const { slug } = z.object({ slug: z.string().max(120) }).parse(req.params);
    const category = await prisma.category.findUnique({ where: { slug } });
    if (!category) return reply.code(404).send({ error: 'Categoria não encontrada' });
    return category;
  });

  app.get('/tags', async req => {
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    return prisma.tag.findMany({
      where: q ? { name: { contains: q } } : undefined,
      take: 50,
      orderBy: { name: 'asc' },
    });
  });
  app.get('/posts', async req => {
    const q = z
      .object({
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(50).default(12),
        category: z.string().max(80).optional(),
        tag: z.string().max(80).optional(),
        q: z.string().trim().max(100).optional(),
        sort: z.enum(['recent', 'popular']).default('recent'),
        locale: z.string().max(10).optional(),
      })
      .parse(req.query);
    const cacheKey = `posts:${q.page}:${q.limit}:${q.category || ''}:${q.tag || ''}:${q.q || ''}:${q.sort}`;
    const cached = await getCache<any>(cacheKey);
    if (cached) return { ...cached, items: await localizePostList(cached.items, q.locale) };
    const now = new Date();
    const where: any = {
      AND: [
        {
          OR: [
            { status: 'PUBLISHED', publishedAt: { lte: now } },
            { status: 'SCHEDULED', scheduledAt: { lte: now } },
          ],
        },
      ],
    };
    if (q.category) where.category = { slug: q.category };
    if (q.tag) where.tags = { some: { tag: { slug: q.tag } } };
    if (q.q)
      where.AND.push({
        OR: [
          { title: { contains: q.q } },
          { description: { contains: q.q } },
        ],
      });
    const [items, total] = await prisma.$transaction([
      prisma.post.findMany({
        where,
        select: publicSelect,
        orderBy:
          q.sort === 'popular'
            ? [{ viewCount: 'desc' }, { publishedAt: 'desc' }]
            : [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.post.count({ where }),
    ]);
    const result = { items, total, page: q.page, pages: Math.ceil(total / q.limit) };
    await setCache(cacheKey, result, 60);
    return { ...result, items: await localizePostList(items, q.locale) };
  });
  app.get('/posts/:slug', async (req, reply) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const { locale } = z.object({ locale: z.string().max(10).optional() }).parse(req.query ?? {});
    const post = await prisma.post.findUnique({
      where: { slug },
      include: {
        category: true,
        author: { select: { id: true, name: true, username: true, avatarUrl: true, bio: true } },
        tags: { include: { tag: true } },
        aiDraft: { select: { coverImageCredit: true, coverImageSourceUrl: true } },
        _count: { select: { comments: true, favorites: true } },
      },
    });
    if (!post) return reply.code(404).send({ error: 'Conteúdo não encontrado' });
    const due =
      (post.status === 'PUBLISHED' && !!post.publishedAt && post.publishedAt <= new Date()) ||
      (post.status === 'SCHEDULED' && !!post.scheduledAt && post.scheduledAt <= new Date());
    if (!due) return reply.code(404).send({ error: 'Conteúdo não encontrado' });
    let viewerId: string | undefined;
    let privileged = false;
    try {
      const payload = await req.jwtVerify<{ sub: string; role: string }>();
      viewerId = payload.sub;
      privileged = ['ADMIN', 'EDITOR'].includes(payload.role);
      if (!privileged) {
        const subscription = await prisma.subscription.findUnique({
          where: { userId: payload.sub },
          select: { status: true, currentPeriodEnd: true },
        });
        privileged =
          subscription?.status === 'ACTIVE' &&
          (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > new Date());
      }
    } catch {}
    const premiumLocked = post.isPremium && !privileged;
    // Visualizações são contadas por POST /posts/:id/view (disparado pelo navegador/app),
    // não pela renderização no servidor, que é cacheada e não representa leitores reais.
    return localizePost({ ...post, content: premiumLocked ? '' : post.content, premiumLocked }, locale);
  });
  app.post('/posts/:id/view', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async req => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    let userId: string | undefined;
    try {
      const p = await req.jwtVerify<{ sub: string }>();
      userId = p.sub;
    } catch {}
    const result = await recordPostView({
      postId: id,
      userId,
      viewer: viewerKey(userId, clientIp(req), String(req.headers['user-agent'] || '')),
    });
    return { ok: true, counted: result.counted };
  });

  app.get('/posts/:id/comments', async req => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    // Comentários ocultados pela moderação (equipe ou triagem comunitária) não aparecem.
    return prisma.comment.findMany({
      where: { postId: id, parentId: null, hiddenAt: null },
      include: {
        user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } },
        _count: { select: { likes: true } },
        replies: {
          where: { hiddenAt: null },
          include: {
            user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } },
            _count: { select: { likes: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
  app.post(
    '/posts/:id/comments',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      await assertVerifiedEmail(req.authUser!.id);
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const { content, parentId } = z
        .object({ content: z.string().trim().min(1).max(3000), parentId: z.string().optional() })
        .parse(req.body);
      const post = await prisma.post.findUnique({
        where: { id },
        select: { id: true, authorId: true, title: true, slug: true, status: true },
      });
      if (!post || post.status === 'DRAFT' || post.status === 'ARCHIVED')
        return reply.code(404).send({ error: 'Post não encontrado' });
      if (parentId) {
        const parentRow = await prisma.comment.findUnique({
          where: { id: parentId },
          select: { postId: true, parentId: true },
        });
        if (!parentRow || parentRow.postId !== id) return reply.code(400).send({ error: 'Comentário pai inválido' });
      }
      const comment = await prisma.comment.create({
        data: { postId: id, userId: req.authUser!.id, parentId, content },
        include: { user: { select: { id: true, name: true, username: true, avatarUrl: true, level: true } } },
      });
      await Promise.all([addXp(req.authUser!.id, XP_RULES.COMMENT_CREATED), unlock(req.authUser!.id, 'FIRST_COMMENT')]);
      let recipient = post.authorId;
      if (parentId) {
        const parent = await prisma.comment.findUnique({ where: { id: parentId }, select: { userId: true } });
        if (parent) recipient = parent.userId;
      }
      await Promise.all([
        notify({
          recipientId: recipient,
          actorId: req.authUser!.id,
          type: parentId ? 'REPLY' : 'COMMENT',
          title: parentId ? 'Responderam seu comentário' : 'Novo comentário',
          body: content.slice(0, 140),
          entityType: 'news',
          entityId: post.slug,
        }).catch(() => undefined),
        notifyFollowersActivity({
          actorId: req.authUser!.id,
          title: `${comment.user.name} comentou em uma notícia`,
          body: `${post.title}: ${content.slice(0, 120)}`,
          entityType: 'news',
          entityId: post.slug,
        }).catch(() => 0),
      ]);
      return reply.code(201).send(comment);
    },
  );
  app.post('/comments/:id/like', { preHandler: authenticate }, async req => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const key = { commentId_userId: { commentId: id, userId: req.authUser!.id } };
    const exists = await prisma.commentLike.findUnique({ where: key });
    if (exists) {
      await prisma.commentLike.delete({ where: key });
      return { liked: false };
    }
    await prisma.commentLike.create({ data: { commentId: id, userId: req.authUser!.id } });
    const [comment, actor] = await Promise.all([
      prisma.comment.findUnique({
        where: { id },
        select: { userId: true, post: { select: { slug: true, title: true } } },
      }),
      prisma.user.findUnique({ where: { id: req.authUser!.id }, select: { name: true } }),
    ]);
    await Promise.all([
      comment
        ? notify({
            recipientId: comment.userId,
            actorId: req.authUser!.id,
            type: 'REACTION',
            title: 'Curtiram seu comentário',
            entityType: 'news',
            entityId: comment.post.slug,
          }).catch(() => undefined)
        : Promise.resolve(),
      notifyFollowersActivity({
        actorId: req.authUser!.id,
        title: `${actor?.name || 'Alguém que você segue'} curtiu um comentário`,
        body: comment?.post.title,
        entityType: comment ? 'news' : undefined,
        entityId: comment?.post.slug,
      }).catch(() => 0),
    ]);
    return { liked: true };
  });
  app.post(
    '/comments/:id/report',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z
        .object({ reason: z.string().min(3).max(100), details: z.string().max(1000).optional() })
        .parse(req.body);
      try {
        await prisma.commentReport.create({ data: { commentId: id, reporterId: req.authUser!.id, ...body } });
        return reply.code(201).send({ ok: true });
      } catch {
        return reply.code(409).send({ error: 'Comentário já denunciado por você' });
      }
    },
  );

  app.post('/favorites/:postId', { preHandler: authenticate }, async req => {
    const { postId } = z.object({ postId: z.string() }).parse(req.params);
    const key = { userId_postId: { userId: req.authUser!.id, postId } };
    const exists = await prisma.favorite.findUnique({ where: key });
    if (exists) {
      await prisma.favorite.delete({ where: key });
      return { favorite: false };
    }
    await prisma.favorite.create({ data: { userId: req.authUser!.id, postId } });
    await prisma.userInteraction.create({ data: { userId: req.authUser!.id, postId, type: 'FAVORITE', weight: 5 } });
    await addXp(req.authUser!.id, XP_RULES.FAVORITE_ADDED);
    const count = await prisma.favorite.count({ where: { userId: req.authUser!.id } });
    if (count >= 10) await unlock(req.authUser!.id, 'COLLECTOR');
    return { favorite: true };
  });
  app.get('/favorites', { preHandler: authenticate }, async req =>
    prisma.favorite.findMany({
      where: { userId: req.authUser!.id },
      include: { post: { select: publicSelect } },
      orderBy: { createdAt: 'desc' },
    }),
  );

  const editor = async (req: any, reply: any) => requireRole('EDITOR', 'ADMIN')(req, reply);

  const postPayloadSchema = z.object({
    title: z.string().trim().min(3).max(180),
    slug: z.string().trim().optional().nullable(),
    description: z.string().trim().min(10).max(500),
    content: z.string().min(10),
    coverImageUrl: z
      .string()
      .url()
      .refine(v => /^https?:\/\//i.test(v), 'A capa deve usar http(s)')
      .optional()
      .nullable()
      .or(z.literal('')),
    categoryId: z.string().min(1),
    tagNames: z.array(z.string().trim().min(1).max(60)).default([]),
    status: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
    isPremium: z.boolean().default(false),
    seoTitle: z.string().max(180).optional().nullable(),
    seoDescription: z.string().max(320).optional().nullable(),
    scheduledAt: z.string().datetime().optional().nullable(),
  });


  async function uniquePostSlug(raw: string, currentPostId?: string) {
    const base = slugify(raw).slice(0, 120) || `artigo-${Date.now()}`;
    let candidate = base;
    for (let i = 0; i < 50; i++) {
      const row = await prisma.post.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!row || row.id === currentPostId) return candidate;
      candidate = `${base}-${i + 2}`;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  function httpError(message: string, statusCode: number, code: string) {
    const error = new Error(message) as Error & { statusCode: number; code: string };
    error.statusCode = statusCode;
    error.code = code;
    return error;
  }

  function prismaCode(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  }

  function normalizeTagInputs(tagNames: string[]) {
    const normalized = new Map<string, string>();
    for (const raw of tagNames) {
      const name = raw.trim().slice(0, 60);
      const tagSlug = slugify(name);
      if (!name || !tagSlug || normalized.has(tagSlug)) continue;
      normalized.set(tagSlug, name);
    }
    return [...normalized].map(([slug, name]) => ({ slug, name }));
  }

  async function resolveTags(tagNames: string[]) {
    const result: Array<{ id: string }> = [];
    for (const input of normalizeTagInputs(tagNames)) {
      let row = await prisma.tag.findFirst({
        where: { OR: [{ slug: input.slug }, { name: { equals: input.name } }] },
        select: { id: true },
      });
      if (!row) {
        try {
          row = await prisma.tag.create({ data: input, select: { id: true } });
        } catch (error) {
          // Outra requisição pode ter criado a mesma tag entre o find e o create.
          if (prismaCode(error) !== 'P2002') throw error;
          row = await prisma.tag.findFirst({
            where: { OR: [{ slug: input.slug }, { name: { equals: input.name } }] },
            select: { id: true },
          });
          if (!row) throw error;
        }
      }
      result.push(row);
    }
    return result;
  }

  async function assertCmsReferences(categoryId: string, userId: string) {
    // Leituras independentes não precisam abrir uma transação. Isso reduz a chance
    // de timeout/connection reset quando o PostgreSQL está ocupado com o worker de IA.
    const [category, author] = await Promise.all([
      prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } }),
    ]);
    if (!category) {
      await delCache('categories');
      throw httpError(
        'Categoria inválida ou desatualizada. Atualize a lista e selecione novamente.',
        400,
        'CATEGORY_STALE',
      );
    }
    if (!author)
      throw httpError('Sua sessão não corresponde mais a um usuário válido. Entre novamente.', 401, 'STALE_SESSION');
    if (author.status !== 'ACTIVE')
      throw httpError('Este usuário não está ativo e não pode salvar conteúdo.', 403, 'USER_INACTIVE');
  }

  async function dbWriteWithRetry<T>(work: () => Promise<T>) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await work();
      } catch (error) {
        lastError = error;
        const code = prismaCode(error);
        if (!['P1001', 'P1002', 'P2024', 'P2034', 'P2028'].includes(code) || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  const cmsWriteSelect = { id: true, slug: true, status: true, updatedAt: true } as const;
  const cmsListSelect = {
    id: true,
    title: true,
    slug: true,
    description: true,
    coverImageUrl: true,
    status: true,
    isPremium: true,
    publishedAt: true,
    scheduledAt: true,
    createdAt: true,
    updatedAt: true,
    category: { select: { id: true, name: true, slug: true } },
    author: { select: { name: true, username: true } },
    aiDraft: { select: { id: true } },
  } as const;

  async function createCmsPost(b: z.infer<typeof postPayloadSchema>, authorId: string) {
    if (b.status === 'SCHEDULED' && !b.scheduledAt)
      throw httpError('Informe a data e hora para agendar a publicação.', 400, 'SCHEDULE_REQUIRED');
    await assertCmsReferences(b.categoryId, authorId);
    const safe = sanitizePostHtml(b.content);
    if (safe.trim().length < 10)
      throw httpError('O conteúdo ficou vazio após a sanitização. Revise o HTML do artigo.', 400, 'EMPTY_CONTENT');
    const slug = await uniquePostSlug(b.slug?.trim() || b.title);
    const tags = await resolveTags(b.tagNames);

    return dbWriteWithRetry(() =>
      prisma.post.create({
        data: {
          title: b.title,
          slug,
          description: b.description,
          content: safe,
          coverImageUrl: b.coverImageUrl || null,
          categoryId: b.categoryId,
          authorId,
          status: b.status,
          isPremium: b.isPremium,
          seoTitle: b.seoTitle?.trim() || null,
          seoDescription: b.seoDescription?.trim() || null,
          publishedAt: b.status === 'PUBLISHED' ? new Date() : null,
          scheduledAt: b.status === 'SCHEDULED' && b.scheduledAt ? new Date(b.scheduledAt) : null,
          tags: tags.length ? { create: tags.map(tag => ({ tag: { connect: { id: tag.id } } })) } : undefined,
        },
        select: cmsWriteSelect,
      }),
    );
  }

  async function updateCmsPost(id: string, b: z.infer<typeof postPayloadSchema>, userId: string) {
    if (b.status === 'SCHEDULED' && !b.scheduledAt)
      throw httpError('Informe a data e hora para agendar a publicação.', 400, 'SCHEDULE_REQUIRED');
    await assertCmsReferences(b.categoryId, userId);
    const current = await prisma.post.findUnique({
      where: { id },
      select: { id: true, status: true, publishedAt: true },
    });
    if (!current) throw httpError('Artigo não encontrado.', 404, 'POST_NOT_FOUND');

    const safe = sanitizePostHtml(b.content);
    if (safe.trim().length < 10)
      throw httpError('O conteúdo ficou vazio após a sanitização. Revise o HTML do artigo.', 400, 'EMPTY_CONTENT');
    const slug = await uniquePostSlug(b.slug?.trim() || b.title, id);
    const tags = await resolveTags(b.tagNames);

    // Um único nested write do Prisma é atômico e muito menor que a antiga
    // transação manual deleteMany -> update -> createMany. Isso evita o ponto
    // onde o save vinha perdendo a conexão quando o banco estava sob carga.
    return dbWriteWithRetry(() =>
      prisma.post.update({
        where: { id },
        data: {
          title: b.title,
          slug,
          description: b.description,
          content: safe,
          coverImageUrl: b.coverImageUrl || null,
          categoryId: b.categoryId,
          status: b.status,
          isPremium: b.isPremium,
          seoTitle: b.seoTitle?.trim() || null,
          seoDescription: b.seoDescription?.trim() || null,
          scheduledAt: b.status === 'SCHEDULED' && b.scheduledAt ? new Date(b.scheduledAt) : null,
          publishedAt: b.status === 'PUBLISHED' ? (current.publishedAt ?? new Date()) : current.publishedAt,
          tags: {
            deleteMany: {},
            ...(tags.length ? { create: tags.map(tag => ({ tag: { connect: { id: tag.id } } })) } : {}),
          },
        },
        select: cmsWriteSelect,
      }),
    );
  }

  // CMS deve ler categorias e conteúdos diretamente do PostgreSQL. Não use o cache
  // público aqui: IDs de categoria stale eram a principal causa de selects vazios e
  // saves rejeitados depois de recriar/sincronizar o banco.
  app.get('/admin/cms/categories', { preHandler: editor }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return prisma.category.findMany({
      select: { id: true, name: true, slug: true, description: true, icon: true },
      orderBy: { name: 'asc' },
    });
  });

  app.get('/admin/cms/bootstrap', { preHandler: editor }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    const [categories, posts] = await Promise.all([
      prisma.category.findMany({
        select: { id: true, name: true, slug: true, description: true, icon: true },
        orderBy: { name: 'asc' },
      }),
      // A listagem nunca devolve o HTML completo do artigo. Antes, dois artigos
      // grandes já eram suficientes para disparar compressão e tornar o payload
      // desnecessariamente pesado no CMS.
      prisma.post.findMany({ select: cmsListSelect, orderBy: { updatedAt: 'desc' } }),
    ]);
    return { categories, posts, totals: { categories: categories.length, posts: posts.length } };
  });

  app.get('/admin/cms/diagnostics', { preHandler: editor }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    const [posts, categories, users] = await Promise.all([
      prisma.post.count(),
      prisma.category.count(),
      prisma.user.count(),
    ]);
    return {
      ok: true,
      database: 'postgresql',
      orm: 'prisma',
      counts: { posts, categories, users },
      time: new Date().toISOString(),
    };
  });

  app.get('/admin/posts', { preHandler: editor }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const q = z.object({ status: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED']).optional() }).parse(req.query);
    return prisma.post.findMany({
      where: q.status ? { status: q.status } : undefined,
      select: cmsListSelect,
      orderBy: { updatedAt: 'desc' },
    });
  });

  app.get('/admin/posts/:id', { preHandler: editor }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        category: true,
        author: { select: { name: true, username: true } },
        tags: { include: { tag: true } },
        aiDraft: {
          include: {
            sources: { select: { id: true, title: true, url: true, publisher: true } },
            job: { select: { id: true, model: true, query: true, timeRange: true, createdAt: true } },
          },
        },
      },
    });
    if (!post) return reply.code(404).send({ error: 'Artigo não encontrado' });
    return post;
  });

  app.post('/admin/posts', { preHandler: editor, bodyLimit: CMS_BODY_LIMIT }, async (req, reply) => {
    const b = postPayloadSchema.parse(req.body);
    req.log.info(
      {
        userId: req.authUser!.id,
        categoryId: b.categoryId,
        titleLength: b.title.length,
        contentLength: b.content.length,
        tagCount: b.tagNames.length,
        status: b.status,
      },
      'Salvando novo artigo no CMS',
    );
    const post = await createCmsPost(b, req.authUser!.id);
    await delCache('posts:*');
    if (post.status === 'PUBLISHED') await queuePostPublished(post.id, req.log);
    else await queuePostSearchSync(post.id, req.log);
    req.log.info({ postId: post.id, slug: post.slug }, 'Artigo salvo com sucesso');
    return reply.code(201).send({ id: post.id, slug: post.slug, status: post.status, updatedAt: post.updatedAt });
  });

  const updatePostHandler = async (req: any, reply: any) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = postPayloadSchema.parse(req.body);
    req.log.info(
      {
        postId: id,
        userId: req.authUser!.id,
        categoryId: b.categoryId,
        contentLength: b.content.length,
        tagCount: b.tagNames.length,
        status: b.status,
      },
      'Atualizando artigo no CMS',
    );
    const before = await prisma.post.findUnique({ where: { id }, select: { publishedAt: true } });
    const post = await updateCmsPost(id, b, req.authUser!.id);
    await delCache('posts:*');
    if (!before?.publishedAt && post.status === 'PUBLISHED') await queuePostPublished(post.id, req.log);
    else await queuePostSearchSync(post.id, req.log);
    req.log.info({ postId: post.id, slug: post.slug }, 'Artigo atualizado com sucesso');
    return reply.send({ id: post.id, slug: post.slug, status: post.status, updatedAt: post.updatedAt });
  };

  // PUT continua sendo a rota REST principal. O alias POST /save existe para
  // clientes/proxies que tratam PUT de forma agressiva e facilita retry manual.
  app.put('/admin/posts/:id', { preHandler: editor, bodyLimit: CMS_BODY_LIMIT }, updatePostHandler);
  app.post('/admin/posts/:id/save', { preHandler: editor, bodyLimit: CMS_BODY_LIMIT }, updatePostHandler);

  app.delete('/admin/posts/:id', { preHandler: editor }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await prisma.post.delete({ where: { id } });
    await delCache('posts:*');
    await queuePostSearchRemove(id, req.log);
    return reply.code(204).send();
  });
};
export default contentRoutes;
