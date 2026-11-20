import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { sanitizePostHtml } from '../lib/post-html.js';
import { requireRole } from '../lib/auth.js';
import { stringList } from '../lib/json-array.js';
import { getAllSettings } from '../services/settings.js';
import {
  currentHash,
  enqueueMissingTranslations,
  isTranslationLocale,
  requestRetranslation,
  translationStats,
  type EntityType,
} from '../services/translation.js';

const entity = z.enum(['post', 'shop']);

const translationsRoutes: FastifyPluginAsync = async app => {
  const editor = async (req: any, reply: any) => requireRole('EDITOR', 'ADMIN')(req, reply);

  /** Visão geral: contagem por status + itens com tradução (paginado). */
  app.get('/admin/translations', { preHandler: editor }, async req => {
    const q = z
      .object({
        type: entity.default('post'),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        filter: z.enum(['all', 'pending', 'failed', 'review', 'outdated']).default('all'),
        q: z.string().trim().max(100).optional(),
      })
      .parse(req.query ?? {});
    const settings = await getAllSettings();
    const locales = settings.translation.locales;

    // Lista do conteúdo original (artigos publicados ou produtos ativos).
    const sources =
      q.type === 'post'
        ? (
            await prisma.post.findMany({
              where: {
                status: { in: ['PUBLISHED', 'SCHEDULED'] },
                ...(q.q ? { title: { contains: q.q } } : {}),
              },
              select: { id: true, title: true, slug: true, publishedAt: true, updatedAt: true },
              orderBy: { publishedAt: 'desc' },
              take: 500,
            })
          ).map(p => ({ id: p.id, title: p.title, slug: p.slug, date: p.publishedAt ?? p.updatedAt }))
        : (
            await prisma.shopProduct.findMany({
              where: { active: true, ...(q.q ? { title: { contains: q.q } } : {}) },
              select: { id: true, title: true, slug: true, updatedAt: true },
              orderBy: { updatedAt: 'desc' },
              take: 500,
            })
          ).map(p => ({ id: p.id, title: p.title, slug: p.slug, date: p.updatedAt }));

    const rows = await prisma.contentTranslation.findMany({
      where: { entityType: q.type, entityId: { in: sources.map(s => s.id) } },
      select: {
        id: true,
        entityId: true,
        locale: true,
        status: true,
        sourceHash: true,
        manualEdit: true,
        reviewedAt: true,
        translatedAt: true,
        error: true,
        model: true,
      },
    });
    const hashes = new Map<string, string | null>();
    // Hash atual só para os que podem estar desatualizados (com edição manual).
    for (const r of rows.filter(r => r.manualEdit)) {
      if (!hashes.has(r.entityId)) hashes.set(r.entityId, await currentHash(q.type, r.entityId));
    }

    const items = sources.map(s => {
      const translations = locales.map(locale => {
        const r = rows.find(x => x.entityId === s.id && x.locale === locale);
        if (!r) return { locale, status: 'MISSING' as const };
        const outdated = r.manualEdit && hashes.get(s.id) !== r.sourceHash;
        return {
          id: r.id,
          locale,
          status: r.status,
          reviewed: Boolean(r.reviewedAt),
          manualEdit: r.manualEdit,
          outdated,
          translatedAt: r.translatedAt,
          error: r.error,
          model: r.model,
        };
      });
      return { ...s, translations };
    });
    const filtered = items.filter(i => {
      if (q.filter === 'all') return true;
      return i.translations.some(t => {
        if (q.filter === 'pending') return t.status === 'PENDING' || t.status === 'PROCESSING' || t.status === 'MISSING';
        if (q.filter === 'failed') return t.status === 'FAILED';
        if (q.filter === 'review') return t.status === 'DONE' && !('reviewed' in t && t.reviewed);
        return 'outdated' in t && t.outdated;
      });
    });
    const start = (q.page - 1) * q.limit;
    return {
      items: filtered.slice(start, start + q.limit),
      total: filtered.length,
      page: q.page,
      pages: Math.max(1, Math.ceil(filtered.length / q.limit)),
      locales,
      settings: settings.translation,
      stats: await translationStats(),
    };
  });

  /** Original + traduções de um item (tela de revisão). */
  app.get('/admin/translations/:type/:id', { preHandler: editor }, async (req, reply) => {
    const { type, id } = z.object({ type: entity, id: z.string().min(1).max(191) }).parse(req.params);
    const source =
      type === 'post'
        ? await prisma.post.findUnique({
            where: { id },
            select: { id: true, title: true, slug: true, description: true, content: true, seoTitle: true, seoDescription: true },
          })
        : await prisma.shopProduct
            .findUnique({ where: { id }, select: { id: true, title: true, slug: true, description: true, highlights: true, badge: true } })
            .then(p => (p ? { ...p, highlights: stringList(p.highlights) } : null));
    if (!source) return reply.code(404).send({ error: 'Conteúdo não encontrado' });
    const hash = await currentHash(type, id);
    const translations = await prisma.contentTranslation.findMany({ where: { entityType: type, entityId: id } });
    return {
      type,
      source,
      translations: translations.map(t => ({ ...t, outdated: t.sourceHash !== hash })),
      locales: (await getAllSettings()).translation.locales,
    };
  });

  /** Edição manual da tradução (fica protegida contra a IA sobrescrever). */
  app.put('/admin/translations/:type/:id/:locale', { preHandler: editor }, async (req, reply) => {
    const p = z.object({ type: entity, id: z.string().min(1).max(191), locale: z.string() }).parse(req.params);
    if (!isTranslationLocale(p.locale)) return reply.code(400).send({ error: 'Idioma não suportado' });
    const body = z
      .object({
        title: z.string().trim().min(1).max(255),
        description: z.string().trim().max(2000).nullable().optional(),
        content: z.string().max(2_000_000).nullable().optional(),
        seoTitle: z.string().trim().max(255).nullable().optional(),
        seoDescription: z.string().trim().max(320).nullable().optional(),
        highlights: z.array(z.string().trim().max(200)).max(10).optional(),
        badge: z.string().trim().max(40).nullable().optional(),
        reviewed: z.boolean().default(true),
      })
      .parse(req.body);
    const hash = await currentHash(p.type as EntityType, p.id);
    if (!hash) return reply.code(404).send({ error: 'Conteúdo não encontrado' });
    const data = {
      title: body.title,
      description: body.description ?? null,
      content: p.type === 'post' && body.content ? sanitizePostHtml(body.content) : null,
      seoTitle: body.seoTitle || null,
      seoDescription: body.seoDescription || null,
      extra: p.type === 'shop' ? { highlights: body.highlights ?? [], badge: body.badge ?? null } : undefined,
      status: 'DONE' as const,
      sourceHash: hash,
      manualEdit: true,
      reviewedAt: body.reviewed ? new Date() : null,
      error: null,
      lockedAt: null,
    };
    const saved = await prisma.contentTranslation.upsert({
      where: { entityType_entityId_locale: { entityType: p.type, entityId: p.id, locale: p.locale } },
      create: { entityType: p.type, entityId: p.id, locale: p.locale, translatedAt: new Date(), ...data },
      update: data,
    });
    return saved;
  });

  /** Marca como revisada sem editar. */
  app.post('/admin/translations/:type/:id/:locale/approve', { preHandler: editor }, async (req, reply) => {
    const p = z.object({ type: entity, id: z.string(), locale: z.string() }).parse(req.params);
    const r = await prisma.contentTranslation.updateMany({
      where: { entityType: p.type, entityId: p.id, locale: p.locale, status: 'DONE' },
      data: { reviewedAt: new Date() },
    });
    if (!r.count) return reply.code(404).send({ error: 'Tradução ainda não está pronta' });
    return { ok: true };
  });

  /** "Traduzir de novo" (um idioma ou todos). */
  app.post('/admin/translations/:type/:id/retranslate', { preHandler: editor }, async req => {
    const p = z.object({ type: entity, id: z.string() }).parse(req.params);
    const body = z.object({ locales: z.array(z.string()).max(4).optional() }).parse(req.body ?? {});
    return { queued: await requestRetranslation(p.type, p.id, body.locales) };
  });

  /** Confere agora o que falta traduzir (o worker também faz isso sozinho a cada 2 min). */
  app.post('/admin/translations/scan', { preHandler: editor }, async () => enqueueMissingTranslations());
};

export default translationsRoutes;
