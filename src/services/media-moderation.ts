import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db.js';
import { TMP_DIR } from '../lib/paths.js';
import { publicUploadUrl } from '../lib/media-store.js';
import { moderateImageFile } from './image-moderation.js';

/**
 * Moderação adiada de imagens de usuários. A API na Hostinger salva como PENDING;
 * o worker no seu PC (com o NudeNet) aprova ou recusa. Ao recusar, a imagem deixa
 * de ser servida, sai do perfil/post e o autor recebe um aviso.
 */
export async function moderatePendingBatch(limit = 10) {
  const pending = await prisma.mediaAsset.findMany({
    where: { moderationStatus: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, name: true, mimeType: true, data: true },
  });
  let approved = 0;
  let rejected = 0;
  await mkdir(TMP_DIR, { recursive: true });
  for (const asset of pending) {
    const file = path.join(TMP_DIR, `mod-${asset.name}`);
    try {
      await writeFile(file, Buffer.from(asset.data as any));
      const result = await moderateImageFile(file, asset.mimeType, asset.name);
      await setModeration(asset.id, result.allowed ? 'APPROVED' : 'REJECTED', result.riskScore ?? null);
      result.allowed ? approved++ : rejected++;
    } finally {
      await unlink(file).catch(() => undefined);
    }
  }
  return { checked: pending.length, approved, rejected };
}

export async function setModeration(id: string, status: 'APPROVED' | 'REJECTED', score: number | null = null) {
  const asset = await prisma.mediaAsset.update({
    where: { id },
    data: { moderationStatus: status, moderationScore: score, moderatedAt: new Date() },
    select: { name: true, uploadedById: true },
  });
  if (status === 'REJECTED') await removeReferences(asset.name, asset.uploadedById);
  return asset;
}

async function removeReferences(name: string, userId: string | null) {
  const url = publicUploadUrl(name);
  const variants = [url, `/uploads/${name}`];
  await prisma.user.updateMany({ where: { avatarUrl: { in: variants } }, data: { avatarUrl: null } });
  await prisma.communityPost.updateMany({ where: { imageUrl: { in: variants } }, data: { imageUrl: null } });
  await prisma.libraryItem.updateMany({ where: { coverUrl: { in: variants } }, data: { coverUrl: null } });
  if (userId)
    await prisma.notification
      .create({
        data: {
          recipientId: userId,
          type: 'SYSTEM',
          title: 'Uma imagem sua foi removida',
          body: 'A moderação automática identificou conteúdo impróprio em uma imagem enviada. Ela foi retirada do seu perfil/publicação.',
        },
      })
      .catch(() => undefined);
}
