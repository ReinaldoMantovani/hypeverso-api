import type { FastifyPluginAsync } from 'fastify';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { reencodeImage } from '../lib/image-processing.js';
import { open as openFile } from 'node:fs/promises';
import { TMP_DIR } from '../lib/paths.js';
import { saveMediaFile } from '../lib/media-store.js';
import { env } from '../config/env.js';
import { prisma } from '../db.js';
import { getAllSettings } from '../services/settings.js';
import { checkImageModerationHealth, moderateImageFile } from '../services/image-moderation.js';

const IMAGE_FORMATS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MODERATED_PURPOSES = new Set(['avatar', 'library', 'community']);
// Imagens de artigo não passam por moderação automática; por isso só a equipe editorial pode enviá-las.
const STAFF_ONLY_PURPOSES = new Set(['article', 'shop']);

// O mimetype do multipart é informado pelo cliente e pode ser falsificado.
// Validamos a assinatura real (magic bytes) do arquivo gravado.
async function detectImageFormat(file: string): Promise<string | null> {
  const handle = await openFile(file, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buf, 0, 16, 0);
    const b = buf.subarray(0, bytesRead);
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      return 'png';
    if (
      b.length >= 6 &&
      (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a')
    )
      return 'gif';
    if (
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP'
    )
      return 'webp';
    if (
      b.length >= 12 &&
      b.subarray(4, 8).toString('ascii') === 'ftyp' &&
      /^(avif|avis)$/.test(b.subarray(8, 12).toString('ascii'))
    )
      return 'avif';
    return null;
  } finally {
    await handle.close();
  }
}

const uploadRoutes: FastifyPluginAsync = async app => {
  app.get('/uploads/moderation-health', { preHandler: authenticate }, async (_req, reply) => {
    // Moderação desligada (padrão na Hostinger) não é erro: responde 200 para o
    // site não ficar registrando 503 no console a cada 10 s.
    const modSettings = (await getAllSettings()).moderation;
    if (!env.IMAGE_MODERATION_ENABLED && !modSettings.enabled)
      return reply.send({ ok: true, enabled: false, mode: 'off', message: 'Moderação automática desligada' });
    if (!env.IMAGE_MODERATION_ENABLED)
      return reply.send({ ok: true, enabled: true, mode: 'deferred', message: 'Imagens são analisadas pelo moderador do PC da equipe' });
    const health = await checkImageModerationHealth();
    return reply.code(health.ok ? 200 : 503).send(health);
  });

  app.post(
    '/uploads',
    { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { purpose } = z
        .object({
          purpose: z.enum(['article', 'avatar', 'library', 'community', 'shop']).default('article'),
        })
        .parse(req.query ?? {});
      if (STAFF_ONLY_PURPOSES.has(purpose) && !['EDITOR', 'ADMIN'].includes(req.authUser!.role)) {
        return reply.code(403).send({ error: 'Apenas a equipe editorial pode enviar imagens de artigos.' });
      }
      const staff = ['EDITOR', 'ADMIN', 'MODERATOR'].includes(req.authUser!.role);
      const modSettings = (await getAllSettings()).moderation;
      // Imagens na comunidade/biblioteca só a partir de um nível (reputação), exceto equipe.
      if (!staff && (purpose === 'community' || purpose === 'library') && modSettings.imageMinLevel > 1) {
        const me = await prisma.user.findUnique({ where: { id: req.authUser!.id }, select: { level: true } });
        if ((me?.level ?? 1) < modSettings.imageMinLevel)
          return reply.code(403).send({
            error: `Envio de imagens liberado a partir do nível ${modSettings.imageMinLevel}. Participe da comunidade para subir de nível!`,
            code: 'IMAGE_LEVEL_REQUIRED',
          });
      }

      const part = await req.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
      if (!part) return reply.code(400).send({ error: 'Arquivo ausente' });

      const ext = IMAGE_FORMATS[part.mimetype.toLowerCase()];
      if (!ext) {
        part.file.resume();
        return reply.code(415).send({
          error: 'Formato de imagem não suportado. Use JPG, PNG, WebP, GIF ou AVIF.',
          supportedFormats: Object.keys(IMAGE_FORMATS),
        });
      }

      const name = `${purpose}-${Date.now()}-${nanoid(12)}.${ext}`;
      // Processa num arquivo temporário e só depois grava no MySQL (MediaAsset).
      const destination = path.join(TMP_DIR, name);
      await mkdir(TMP_DIR, { recursive: true });

      try {
        await pipeline(part.file, createWriteStream(destination, { flags: 'wx' }));
        if (part.file.truncated) {
          await unlink(destination).catch(() => {});
          return reply.code(413).send({ error: 'A imagem excede o limite de 15 MB.' });
        }

        const realFormat = await detectImageFormat(destination);
        if (!realFormat || (realFormat !== ext && !(realFormat === 'jpg' && ext === 'jpg'))) {
          await unlink(destination).catch(() => {});
          return reply.code(415).send({ error: 'O conteúdo do arquivo não corresponde a uma imagem válida.' });
        }

        // Reescreve a imagem com sharp: remove EXIF/GPS e qualquer payload extra.
        let processed;
        try {
          processed = await reencodeImage(destination, ext as any);
        } catch (error) {
          req.log.warn({ err: error }, 'Imagem rejeitada no reprocessamento');
          await unlink(destination).catch(() => {});
          return reply.code(415).send({ error: 'Não foi possível processar esta imagem. Tente outro arquivo.' });
        }

        let moderation: { allowed: boolean; riskScore?: number; model?: string; policy?: string } | undefined;
        // Moderação imediata só quando o moderador (NudeNet) está no mesmo servidor. Na Hostinger
        // a imagem entra como PENDENTE e o worker de moderação no seu PC verifica em seguida.
        const inlineModeration = env.IMAGE_MODERATION_ENABLED.toLowerCase() === 'true';
        const deferredModeration = MODERATED_PURPOSES.has(purpose) && !inlineModeration && !staff && modSettings.enabled;
        if (MODERATED_PURPOSES.has(purpose) && inlineModeration) {
          moderation = await moderateImageFile(destination, part.mimetype, part.filename);
          if (!moderation.allowed) {
            await unlink(destination).catch(() => {});
            return reply.code(422).send({
              error: 'A imagem foi recusada pela moderação de segurança. Escolha outra imagem.',
              code: 'IMAGE_MODERATION_REJECTED',
            });
          }
        }

        const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        const url = await saveMediaFile(name, destination, {
          mimeType,
          purpose,
          width: processed.width,
          height: processed.height,
          uploadedById: req.authUser!.id,
          moderationStatus: deferredModeration ? 'PENDING' : moderation ? 'APPROVED' : 'NOT_REQUIRED',
        });
        return {
          url,
          format: ext,
          mimeType: part.mimetype,
          originalName: path.basename(part.filename || '').slice(0, 200),
          moderated: Boolean(moderation),
          moderationPending: deferredModeration,
          width: processed.width,
          height: processed.height,
          bytes: processed.bytes,
        };
      } catch (error) {
        await unlink(destination).catch(() => {});
        throw error;
      }
    },
  );
};
export default uploadRoutes;
