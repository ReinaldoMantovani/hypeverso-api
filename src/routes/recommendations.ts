import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import { semanticCandidates } from '../services/embeddings.js';

const selectPost = {
  id: true,
  title: true,
  slug: true,
  description: true,
  coverImageUrl: true,
  publishedAt: true,
  categoryId: true,
  category: { select: { id: true, name: true, slug: true } },
  _count: { select: { favorites: true, comments: true, interactions: true } },
} as const;

function daysAgo(date: Date | null) {
  if (!date) return 365;
  return Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
}

const recommendationsRoutes: FastifyPluginAsync = async app => {
  app.get('/recommendations', async req => {
    let userId: string | undefined;
    try {
      userId = (await req.jwtVerify<{ sub: string }>()).sub;
    } catch {}

    if (!userId) {
      const posts = await prisma.post.findMany({
        where: { status: 'PUBLISHED', publishedAt: { lte: new Date() } },
        select: selectPost,
        orderBy: { publishedAt: 'desc' },
        take: 12,
      });
      return posts.map(post => ({
        ...post,
        recommendationReason: 'Em destaque no Hypeverso',
        recommendationStrategy: 'recent',
      }));
    }

    const [favs, interactions, preferences, semantic] = await Promise.all([
      prisma.favorite.findMany({ where: { userId }, select: { postId: true, post: { select: { categoryId: true } } } }),
      prisma.userInteraction.findMany({
        where: { userId, createdAt: { gte: new Date(Date.now() - 120 * 86_400_000) } },
        select: { postId: true, weight: true, type: true, post: { select: { categoryId: true } } },
        orderBy: { createdAt: 'desc' },
        take: 250,
      }),
      prisma.userNewsCategoryPreference.findMany({
        where: { userId },
        select: { categoryId: true, category: { select: { name: true } } },
      }),
      semanticCandidates(userId, 36),
    ]);

    const categoryScore = new Map<string, number>();
    const categoryNames = new Map<string, string>();
    for (const fav of favs) categoryScore.set(fav.post.categoryId, (categoryScore.get(fav.post.categoryId) || 0) + 8);
    for (const item of interactions)
      categoryScore.set(
        item.post.categoryId,
        (categoryScore.get(item.post.categoryId) || 0) + Math.max(1, item.weight),
      );
    for (const pref of preferences) {
      categoryScore.set(pref.categoryId, (categoryScore.get(pref.categoryId) || 0) + 10);
      categoryNames.set(pref.categoryId, pref.category.name);
    }

    const topCategories = [...categoryScore.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);
    const semanticMap = new Map(semantic.map(row => [row.id, Math.max(0, Math.min(1, row.similarity))]));
    const seenIds = new Set([
      ...favs.map(f => f.postId),
      ...interactions
        .filter(i => i.type === 'VIEW')
        .slice(0, 100)
        .map(i => i.postId),
    ]);

    const semanticIds = semantic.map(row => row.id);
    const categoryCandidates = await prisma.post.findMany({
      where: {
        status: 'PUBLISHED',
        publishedAt: { lte: new Date() },
        ...(topCategories.length ? { categoryId: { in: topCategories } } : {}),
        id: { notIn: [...seenIds].slice(0, 300) },
      },
      select: selectPost,
      orderBy: { publishedAt: 'desc' },
      take: 30,
    });

    const semanticPosts = semanticIds.length
      ? await prisma.post.findMany({
          where: { id: { in: semanticIds }, status: 'PUBLISHED', publishedAt: { lte: new Date() } },
          select: selectPost,
        })
      : [];

    const byId = new Map<string, (typeof categoryCandidates)[number]>();
    for (const post of [...semanticPosts, ...categoryCandidates]) byId.set(post.id, post);

    const maxCategory = Math.max(1, ...categoryScore.values());
    const scored = [...byId.values()].map(post => {
      const similarity = semanticMap.get(post.id) || 0;
      const affinity = (categoryScore.get(post.categoryId) || 0) / maxCategory;
      const freshness = Math.max(0, 1 - daysAgo(post.publishedAt) / 90);
      const popularityRaw =
        post._count.favorites * 3 + post._count.comments * 2 + Math.min(post._count.interactions, 25);
      const popularity = Math.min(1, popularityRaw / 40);
      const score = similarity * 0.6 + affinity * 0.22 + freshness * 0.12 + popularity * 0.06;

      let recommendationReason = 'Selecionado para você';
      if (similarity >= 0.55) recommendationReason = 'Parecido com conteúdos que você curtiu';
      else if (categoryScore.get(post.categoryId))
        recommendationReason = `Porque você acompanha ${categoryNames.get(post.categoryId) || post.category.name}`;
      else if (freshness > 0.85) recommendationReason = 'Novidade que combina com seu perfil';

      return {
        ...post,
        recommendationReason,
        recommendationStrategy: semantic.length ? 'hybrid-semantic' : 'category-affinity',
        recommendationScore: Number(score.toFixed(4)),
      };
    });

    const result = scored.sort((a, b) => b.recommendationScore - a.recommendationScore).slice(0, 12);
    if (result.length) return result;

    const fallback = await prisma.post.findMany({
      where: { status: 'PUBLISHED', publishedAt: { lte: new Date() } },
      select: selectPost,
      orderBy: { publishedAt: 'desc' },
      take: 12,
    });
    return fallback.map(post => ({
      ...post,
      recommendationReason: 'Novidade no Hypeverso',
      recommendationStrategy: 'fallback',
    }));
  });

  app.get('/recommendations/status', async () => {
    const [embeddings, published] = await Promise.all([
      prisma.postEmbedding.count(),
      prisma.post.count({ where: { status: 'PUBLISHED', publishedAt: { lte: new Date() } } }),
    ]);
    return { ok: true, embeddings, published, coverage: published ? Number((embeddings / published).toFixed(3)) : 1 };
  });
};

export default recommendationsRoutes;
