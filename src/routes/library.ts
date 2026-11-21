import { CATALOG_PROVIDERS } from '../services/media-catalog.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate } from '../lib/auth.js';
import { isManagedUploadUrl } from '../lib/managed-upload.js';
import { cacheCatalogItem, getCatalogDetails, mediaTypes } from '../services/media-catalog.js';

const statuses = [
  'WATCHING',
  'WANT_TO_WATCH',
  'COMPLETED',
  'DROPPED',
  'READING',
  'WANT_TO_READ',
  'PLAYING',
  'WANT_TO_PLAY',
] as const;
const providers = CATALOG_PROVIDERS;

const libraryRoutes: FastifyPluginAsync = async app => {
  app.get('/library', { preHandler: authenticate }, async req => {
    const { status } = z.object({ status: z.enum(statuses).optional() }).parse(req.query);
    return prisma.libraryItem.findMany({
      where: { userId: req.authUser!.id, ...(status ? { status } : {}) },
      include: {
        catalogItem: {
          select: {
            id: true,
            provider: true,
            externalId: true,
            mediaType: true,
            description: true,
            backdropUrl: true,
            releaseDate: true,
            genres: true,
            rating: true,
            sourceUrl: true,
            trailerUrl: true,
            metadata: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  });

  app.post('/library/from-catalog', { preHandler: authenticate }, async (req, reply) => {
    const body = z
      .object({
        provider: z.enum(providers),
        externalId: z.string().min(1).max(120),
        mediaType: z.enum(mediaTypes),
        status: z.enum(statuses),
        notes: z.string().max(1000).optional().nullable(),
        rating: z.number().int().min(1).max(10).optional().nullable(),
      })
      .parse(req.body);
    const details = await getCatalogDetails(body.provider, body.mediaType, body.externalId);
    if (!details)
      return reply.code(404).send({ error: 'Não foi possível carregar os dados completos deste item do catálogo.' });
    const catalog = await cacheCatalogItem(details);
    const externalId = `${body.provider}:${body.externalId}`;
    const item = await prisma.libraryItem.upsert({
      where: { userId_externalId_mediaType: { userId: req.authUser!.id, externalId, mediaType: body.mediaType } },
      update: {
        title: details.title,
        coverUrl: details.coverUrl || null,
        status: body.status,
        notes: body.notes,
        rating: body.rating,
        catalogItemId: catalog.id,
      },
      create: {
        userId: req.authUser!.id,
        externalId,
        title: details.title,
        mediaType: body.mediaType,
        coverUrl: details.coverUrl || null,
        status: body.status,
        notes: body.notes,
        rating: body.rating,
        catalogItemId: catalog.id,
      },
      include: { catalogItem: true },
    });
    return reply.code(201).send(item);
  });

  app.post('/library', { preHandler: authenticate }, async (req, reply) => {
    const b = z
      .object({
        externalId: z.string().min(1),
        title: z.string().min(1),
        mediaType: z.enum(mediaTypes),
        coverUrl: z.string().url().optional().nullable(),
        status: z.enum(statuses),
        notes: z.string().max(1000).optional().nullable(),
        rating: z.number().int().min(1).max(10).optional().nullable(),
      })
      .parse(req.body);
    if (b.coverUrl && !isManagedUploadUrl(b.coverUrl, ['library']))
      return reply.code(400).send({ error: 'A capa manual deve ser enviada pelo upload seguro do Hypeverso.' });
    return prisma.libraryItem.upsert({
      where: {
        userId_externalId_mediaType: { userId: req.authUser!.id, externalId: b.externalId, mediaType: b.mediaType },
      },
      update: { title: b.title, coverUrl: b.coverUrl, status: b.status, notes: b.notes, rating: b.rating },
      create: { userId: req.authUser!.id, ...b },
    });
  });

  app.patch('/library/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z
      .object({
        title: z.string().min(1).optional(),
        coverUrl: z.string().url().optional().nullable(),
        status: z.enum(statuses).optional(),
        notes: z.string().max(1000).optional().nullable(),
        rating: z.number().int().min(1).max(10).optional().nullable(),
      })
      .parse(req.body);
    if (b.coverUrl && !isManagedUploadUrl(b.coverUrl, ['library']))
      return reply.code(400).send({ error: 'A capa manual deve ser enviada pelo upload seguro do Hypeverso.' });
    const item = await prisma.libraryItem.findFirst({ where: { id, userId: req.authUser!.id } });
    if (!item) return reply.code(404).send({ error: 'Item não encontrado' });
    return prisma.libraryItem.update({ where: { id }, data: b });
  });

  app.delete('/library/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await prisma.libraryItem.deleteMany({ where: { id, userId: req.authUser!.id } });
    return reply.code(204).send();
  });
};
export default libraryRoutes;
