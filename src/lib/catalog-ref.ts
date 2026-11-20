import { z } from 'zod';
import { prisma } from '../db.js';
import { cacheCatalogItem, getCatalogDetails, mediaTypes } from '../services/media-catalog.js';

export const catalogRefSchema = z.union([
  z.object({ catalogItemId: z.string().min(1).max(40) }),
  z.object({
    provider: z.enum(['TMDB', 'IGDB', 'ANILIST']),
    mediaType: z.enum(mediaTypes),
    externalId: z.string().min(1).max(120),
  }),
]);

/** Resolve um item do catálogo pelo id local ou pela referência externa (cacheando-o localmente). */
export async function resolveCatalogItem(ref: z.infer<typeof catalogRefSchema>) {
  if ('catalogItemId' in ref) {
    return prisma.mediaCatalogItem.findUnique({ where: { id: ref.catalogItemId }, select: { id: true, title: true } });
  }
  const details = await getCatalogDetails(ref.provider, ref.mediaType, ref.externalId);
  if (!details) return null;
  const cached = await cacheCatalogItem(details);
  return { id: cached.id, title: details.title };
}

export const catalogCardSelect = {
  id: true,
  provider: true,
  externalId: true,
  mediaType: true,
  title: true,
  coverUrl: true,
  releaseDate: true,
} as const;
