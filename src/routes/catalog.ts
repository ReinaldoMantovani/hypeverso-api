import { CATALOG_PROVIDERS } from '../services/media-catalog.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../lib/auth.js';
import {
  cacheCatalogItem,
  getCatalogDetails,
  getCatalogReleases,
  mediaTypes,
  providerAvailability,
  diagnoseProviders,
  searchCatalog,
} from '../services/media-catalog.js';

const providers = CATALOG_PROVIDERS;
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD');

const catalogRoutes: FastifyPluginAsync = async app => {
  app.get('/catalog/providers', async () => ({ providers: providerAvailability() }));
  // Diagnóstico: testa TMDB, AniList e IGDB de verdade (abra logado como admin).
  app.get('/catalog/diagnostics', { preHandler: requireRole('ADMIN', 'EDITOR') }, async () => diagnoseProviders());

  app.get('/catalog/search', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async req => {
    const { q, type } = z
      .object({ q: z.string().trim().min(2).max(120), type: z.enum(mediaTypes).optional() })
      .parse(req.query);
    const items = await searchCatalog(q, type);
    return { items, providers: providerAvailability() };
  });

  app.get('/catalog/releases', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async req => {
    const { from, to, type } = z
      .object({ from: dateSchema, to: dateSchema, type: z.enum(mediaTypes).optional() })
      .parse(req.query);
    const items = await getCatalogReleases(from, to, type);
    return { items, providers: providerAvailability(), from, to, type: type || null };
  });

  app.get(
    '/catalog/:provider/:type/:externalId',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { provider, type, externalId } = z
        .object({ provider: z.enum(providers), type: z.enum(mediaTypes), externalId: z.string().min(1).max(120) })
        .parse(req.params);
      const item = await getCatalogDetails(provider, type, externalId);
      if (!item) return reply.code(404).send({ error: 'Item não encontrado no catálogo' });
      const cached = await cacheCatalogItem(item);
      return { ...item, catalogId: cached.id };
    },
  );

  app.get('/catalog/items/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const item = await prisma.mediaCatalogItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ error: 'Item do catálogo não encontrado' });
    return item;
  });

  app.get('/catalog/items/:id/related-posts', async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const item = await prisma.mediaCatalogItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ error: 'Item do catálogo não encontrado' });
    const terms = [item.title, item.originalTitle || '']
      .flatMap(v => v.split(/[^\p{L}\p{N}]+/u))
      .map(v => v.trim())
      .filter(v => v.length >= 4)
      .filter((v, i, a) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i)
      .slice(0, 5);
    const or: any[] = [{ title: { contains: item.title } }];
    if (item.originalTitle && item.originalTitle !== item.title)
      or.push({ title: { contains: item.originalTitle } });
    for (const term of terms) {
      or.push({ title: { contains: term } });
      or.push({ description: { contains: term } });
      or.push({ tags: { some: { tag: { name: { contains: term } } } } });
    }
    const posts = await prisma.post.findMany({
      where: { status: 'PUBLISHED', OR: or },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        coverImageUrl: true,
        publishedAt: true,
        category: { select: { name: true, slug: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 6,
    });
    return { posts };
  });

  app.get('/catalog/reminders', { preHandler: authenticate }, async req => {
    return prisma.mediaReleaseReminder.findMany({
      where: { userId: req.authUser!.id },
      include: { catalogItem: true },
      orderBy: [{ notifiedAt: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  });

  app.get('/catalog/reminders/:catalogItemId', { preHandler: authenticate }, async req => {
    const { catalogItemId } = z.object({ catalogItemId: z.string().min(1) }).parse(req.params);
    const reminder = await prisma.mediaReleaseReminder.findUnique({
      where: { userId_catalogItemId: { userId: req.authUser!.id, catalogItemId } },
    });
    return { reminder };
  });

  app.post('/catalog/reminders', { preHandler: authenticate }, async (req, reply) => {
    const body = z
      .object({
        catalogItemId: z.string().optional(),
        provider: z.enum(providers).optional(),
        externalId: z.string().min(1).max(120).optional(),
        mediaType: z.enum(mediaTypes).optional(),
        remindBeforeDays: z.number().int().min(0).max(30).default(1),
      })
      .refine(v => Boolean(v.catalogItemId || (v.provider && v.externalId && v.mediaType)), {
        message: 'Informe catalogItemId ou provider/externalId/mediaType',
      })
      .parse(req.body);
    let catalog = body.catalogItemId
      ? await prisma.mediaCatalogItem.findUnique({ where: { id: body.catalogItemId } })
      : null;
    if (!catalog && body.provider && body.externalId && body.mediaType) {
      const details = await getCatalogDetails(body.provider, body.mediaType, body.externalId);
      if (!details) return reply.code(404).send({ error: 'Não foi possível carregar este lançamento.' });
      catalog = await cacheCatalogItem(details);
    }
    if (!catalog) return reply.code(404).send({ error: 'Item do catálogo não encontrado' });
    if (!catalog.releaseDate)
      return reply.code(400).send({ error: 'Este item ainda não possui uma data de lançamento definida.' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const release = new Date(catalog.releaseDate);
    release.setHours(0, 0, 0, 0);
    if (release.getTime() < today.getTime()) return reply.code(400).send({ error: 'Este lançamento já ocorreu.' });
    const reminder = await prisma.mediaReleaseReminder.upsert({
      where: { userId_catalogItemId: { userId: req.authUser!.id, catalogItemId: catalog.id } },
      update: { remindBeforeDays: body.remindBeforeDays, notifiedAt: null },
      create: { userId: req.authUser!.id, catalogItemId: catalog.id, remindBeforeDays: body.remindBeforeDays },
      include: { catalogItem: true },
    });
    return reply.code(201).send(reminder);
  });

  app.delete('/catalog/reminders/:catalogItemId', { preHandler: authenticate }, async (req, reply) => {
    const { catalogItemId } = z.object({ catalogItemId: z.string().min(1) }).parse(req.params);
    await prisma.mediaReleaseReminder.deleteMany({ where: { userId: req.authUser!.id, catalogItemId } });
    return reply.code(204).send();
  });
};
export default catalogRoutes;
