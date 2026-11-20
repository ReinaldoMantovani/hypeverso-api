import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { UPLOAD_DIR } from './paths.js';

/**
 * Armazenamento de imagens no MySQL (tabela MediaAsset).
 *
 * Na Hostinger (Node.js Web App) a pasta da aplicação é recriada a cada deploy,
 * então arquivos gravados em disco sumiriam. Guardando no banco, as imagens
 * sobrevivem a deploys e o worker de IA no seu PC (que fala com o MySQL remoto)
 * também consegue publicar imagens que o site enxerga na hora.
 */

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};
export const MAX_STORED_BYTES = 12 * 1024 * 1024;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;

type MediaOptions = {
  mimeType?: string;
  purpose?: string;
  width?: number;
  height?: number;
  uploadedById?: string;
  moderationStatus?: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
};

// Imagem neutra servida no lugar de fotos recusadas (ou pendentes, se configurado).
const PLACEHOLDER_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="#140d24"/><path d="M200 140a40 40 0 1 1 0 80a40 40 0 1 1 0-80zm-90 170c10-45 50-70 90-70s80 25 90 70z" fill="#3b2a63"/></svg>',
);

export function mimeFromName(name: string) {
  return MIME_BY_EXT[name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';
}

export function publicUploadUrl(name: string) {
  return `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/uploads/${name}`;
}

export async function saveMediaBuffer(
  name: string,
  data: Buffer,
  options: MediaOptions = {},
) {
  if (!SAFE_NAME.test(name)) throw new Error('Nome de arquivo inválido');
  if (!data.length || data.length > MAX_STORED_BYTES) throw new Error('Imagem vazia ou grande demais');
  await prisma.mediaAsset.create({
    data: {
      name,
      data: data as any,
      bytes: data.length,
      mimeType: options.mimeType || mimeFromName(name),
      purpose: options.purpose || name.split('-')[0] || 'article',
      width: options.width,
      height: options.height,
      uploadedById: options.uploadedById,
      moderationStatus: options.moderationStatus || 'NOT_REQUIRED',
    },
  });
  return publicUploadUrl(name);
}

/** Lê um arquivo temporário já validado/reprocessado, grava no banco e apaga o temporário. */
export async function saveMediaFile(
  name: string,
  filePath: string,
  options: MediaOptions = {},
) {
  try {
    const data = await readFile(filePath);
    return await saveMediaBuffer(name, data, options);
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

let hidePendingCache: { at: number; value: boolean } | null = null;
async function hidePending() {
  if (hidePendingCache && Date.now() - hidePendingCache.at < 60_000) return hidePendingCache.value;
  const { getAllSettings } = await import('../services/settings.js');
  const value = (await getAllSettings()).moderation.hideUntilApproved;
  hidePendingCache = { at: Date.now(), value };
  return value;
}

/** GET /uploads/:name (e /uploads/ai-news/:name antigos): banco primeiro, disco como legado. */
export function registerUploadServing(app: FastifyInstance) {
  const serve = async (req: any, reply: any, rawName: string, legacyDir?: string) => {
    if (!SAFE_NAME.test(rawName)) return reply.code(404).send({ error: 'Arquivo não encontrado' });
    reply.headers(SECURITY_HEADERS);
    const asset = await prisma.mediaAsset.findUnique({
      where: { name: rawName },
      select: { data: true, mimeType: true, bytes: true, createdAt: true, moderationStatus: true },
    });
    const hidden =
      asset &&
      (asset.moderationStatus === 'REJECTED' ||
        (asset.moderationStatus === 'PENDING' && (await hidePending())));
    if (asset && hidden) {
      return reply
        .header('content-type', 'image/svg+xml')
        .header('cache-control', 'no-store')
        .send(PLACEHOLDER_SVG);
    }
    if (asset) {
      // Pendente: cache curto, para a versão aprovada/recusada valer logo.
      const cacheControl =
        asset.moderationStatus === 'PENDING' ? 'public, max-age=300' : 'public, max-age=31536000, immutable';
      const etag = `"${createHash('sha1').update(rawName + asset.bytes).digest('hex').slice(0, 20)}"`;
      if (req.headers['if-none-match'] === etag) return reply.code(304).send();
      return reply
        .header('content-type', asset.mimeType)
        .header('cache-control', cacheControl)
        .header('etag', etag)
        .header('last-modified', asset.createdAt.toUTCString())
        .send(Buffer.from(asset.data as any));
    }
    // Compatibilidade: imagens antigas que ainda estejam no disco.
    try {
      const file = path.join(UPLOAD_DIR, ...(legacyDir ? [legacyDir] : []), rawName);
      if (!file.startsWith(UPLOAD_DIR)) throw new Error('fora da pasta');
      const data = await readFile(file);
      return reply
        .header('content-type', mimeFromName(rawName))
        .header('cache-control', 'public, max-age=86400')
        .send(data);
    } catch {
      return reply.code(404).header('cache-control', 'no-store').send({ error: 'Arquivo não encontrado' });
    }
  };
  app.get('/uploads/:name', (req: any, reply) => serve(req, reply, String(req.params.name || '')));
  app.get('/uploads/ai-news/:name', (req: any, reply) => serve(req, reply, String(req.params.name || ''), 'ai-news'));
}
