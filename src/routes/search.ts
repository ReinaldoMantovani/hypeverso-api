import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { searchIndexHealth, searchPostsWithMeili } from '../services/search-index.js';

const postSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  coverImageUrl: true,
  isPremium: true,
  publishedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  author: { select: { name: true, username: true } },
  tags: { select: { tag: { select: { name: true, slug: true } } } },
} as const;

async function databasePostSearch(input: {
  q: string;
  category?: string;
  tag?: string;
  premium?: boolean;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
  sort?: 'relevance' | 'recent' | 'oldest' | 'title';
}) {
  const page = Math.max(1, input.page || 1);
  const limit = Math.min(50, Math.max(1, input.limit || 20));
  const now = new Date();
  const where: any = {
    status: 'PUBLISHED',
    publishedAt: { lte: now, ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) },
    OR: [
      { title: { contains: input.q } },
      { description: { contains: input.q } },
      // Conteúdo premium não pode ser sondado via busca textual.
      { isPremium: false, content: { contains: input.q } },
      { tags: { some: { tag: { name: { contains: input.q } } } } },
    ],
  };
  if (input.category) where.category = { slug: input.category };
  if (input.tag) where.tags = { some: { tag: { slug: input.tag } } };
  if (input.premium !== undefined) where.isPremium = input.premium;

  const orderBy =
    input.sort === 'oldest'
      ? [{ publishedAt: 'asc' as const }]
      : input.sort === 'title'
        ? [{ title: 'asc' as const }]
        : [{ publishedAt: 'desc' as const }];

  const [posts, total] = await Promise.all([
    prisma.post.findMany({ where, select: postSelect, orderBy, skip: (page - 1) * limit, take: limit }),
    prisma.post.count({ where }),
  ]);
  return { posts, total, page, pages: Math.ceil(total / limit), facets: {}, engine: 'mysql' as const };
}

const searchRoutes: FastifyPluginAsync = async app => {
  app.get('/search/suggest', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async req => {
    const { q } = z.object({ q: z.string().trim().min(1).max(100) }).parse(req.query);
    try {
      const result = await searchPostsWithMeili({ q, page: 1, limit: 8, sort: 'relevance' });
      return { posts: result.posts, engine: result.engine };
    } catch {
      const rows = await prisma.post.findMany({
        where: {
          status: 'PUBLISHED',
          publishedAt: { lte: new Date() },
          OR: [{ title: { contains: q } }, { description: { contains: q } }],
        },
        select: postSelect,
        take: 16,
        orderBy: { publishedAt: 'desc' },
      });
      const needle = q.toLocaleLowerCase('pt-BR');
      const posts = rows
        .sort((a, b) => {
          const at = a.title.toLocaleLowerCase('pt-BR');
          const bt = b.title.toLocaleLowerCase('pt-BR');
          return (at.startsWith(needle) ? 0 : 1) - (bt.startsWith(needle) ? 0 : 1) || at.localeCompare(bt, 'pt-BR');
        })
        .slice(0, 8);
      return { posts, engine: 'mysql' };
    }
  });

  app.get('/search', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async req => {
    const query = z
      .object({
        q: z.string().trim().min(1).max(100),
        type: z.enum(['all', 'posts', 'users', 'categories', 'tags']).default('all'),
        category: z.string().trim().optional(),
        tag: z.string().trim().optional(),
        premium: z.enum(['true', 'false']).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        sort: z.enum(['relevance', 'recent', 'oldest', 'title']).default('relevance'),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);

    let userId: string | undefined;
    try {
      userId = (await req.jwtVerify<{ sub: string }>()).sub;
    } catch {}
    if (userId && query.q.length >= 2) {
      await prisma.searchHistory.create({ data: { userId, query: query.q } }).catch(() => undefined);
    }

    const postInput = {
      q: query.q,
      category: query.category,
      tag: query.tag,
      premium: query.premium === undefined ? undefined : query.premium === 'true',
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
    };

    let postResult: Awaited<ReturnType<typeof databasePostSearch>> | Awaited<ReturnType<typeof searchPostsWithMeili>> =
      {
        posts: [],
        total: 0,
        page: query.page,
        pages: 0,
        facets: {},
        engine: 'mysql',
      };
    if (['all', 'posts'].includes(query.type)) {
      try {
        postResult = await searchPostsWithMeili(postInput);
      } catch {
        postResult = await databasePostSearch(postInput);
      }
    }

    const [users, categories, tags] = await Promise.all([
      ['all', 'users'].includes(query.type)
        ? prisma.user.findMany({
            where: {
              status: 'ACTIVE',
              OR: [
                { name: { contains: query.q } },
                { username: { contains: query.q } },
              ],
            },
            select: { id: true, name: true, username: true, avatarUrl: true, bio: true, level: true },
            take: 12,
          })
        : [],
      ['all', 'categories'].includes(query.type)
        ? prisma.category.findMany({
            where: { name: { contains: query.q } },
            take: 10,
            orderBy: { name: 'asc' },
          })
        : [],
      ['all', 'tags'].includes(query.type)
        ? prisma.tag.findMany({
            where: { name: { contains: query.q } },
            take: 20,
            orderBy: { name: 'asc' },
          })
        : [],
    ]);

    return {
      posts: postResult.posts,
      users,
      categories,
      tags,
      meta: {
        engine: postResult.engine,
        total: postResult.total,
        page: postResult.page,
        pages: postResult.pages,
        facets: postResult.facets,
      },
    };
  });

  app.get('/search/status', async () => {
    const search = await searchIndexHealth();
    return { ok: search.ok, engine: search.ok ? 'meilisearch' : 'mysql-fallback', search };
  });

  app.get('/search/history', async (req, reply) => {
    try {
      const p = await req.jwtVerify<{ sub: string }>();
      return prisma.searchHistory.findMany({ where: { userId: p.sub }, orderBy: { createdAt: 'desc' }, take: 20 });
    } catch {
      return reply.code(401).send({ error: 'Não autenticado' });
    }
  });
};

export default searchRoutes;
