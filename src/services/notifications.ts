import { prisma } from '../db.js';
import { pushNewsPublished, pushToUser } from './push.js';

type NotificationInput = {
  recipientId: string;
  actorId?: string;
  type: any;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
};

export async function notify(data: NotificationInput) {
  if (data.actorId === data.recipientId) return;
  await prisma.notification.create({ data });
}

/**
 * Notifica todos que seguem um usuário quando ele executa uma atividade pública.
 * Atividades privadas (biblioteca, favoritos, histórico) nunca entram aqui.
 */
export async function notifyFollowersActivity(data: {
  actorId: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}) {
  const followers = await prisma.userFollow.findMany({
    where: { followingId: data.actorId },
    select: { followerId: true },
  });
  if (!followers.length) return 0;
  const rows = followers
    .filter(row => row.followerId !== data.actorId)
    .map(row => ({
      recipientId: row.followerId,
      actorId: data.actorId,
      type: 'FOLLOW_ACTIVITY' as any,
      title: data.title,
      body: data.body,
      entityType: data.entityType,
      entityId: data.entityId,
    }));
  if (!rows.length) return 0;
  const result = await prisma.notification.createMany({ data: rows });
  return result.count;
}

/** Dispara a notícia somente para usuários que selecionaram a categoria no perfil. */
export async function notifyNewsPublished(postId: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      title: true,
      slug: true,
      authorId: true,
      categoryId: true,
      coverImageUrl: true,
      category: { select: { name: true } },
    },
  });
  if (!post) return 0;

  // Web Push para dispositivos inscritos (independe de conta).
  await pushNewsPublished({
    title: post.title,
    slug: post.slug,
    categoryId: post.categoryId,
    categoryName: post.category.name,
    coverImageUrl: post.coverImageUrl,
  }).catch(() => 0);

  const subscriptions = await prisma.userNewsCategoryPreference.findMany({
    where: { categoryId: post.categoryId, userId: { not: post.authorId } },
    select: { userId: true },
  });
  if (!subscriptions.length) return 0;

  const result = await prisma.notification.createMany({
    data: subscriptions.map(s => ({
      recipientId: s.userId,
      actorId: post.authorId,
      type: 'NEWS' as any,
      title: `Nova notícia em ${post.category.name}`,
      body: post.title,
      entityType: 'news',
      entityId: post.slug,
    })),
  });
  return result.count;
}

/**
 * Processa lembretes de lançamentos do Media Hub. O claim do lembrete e a criação
 * da notificação acontecem na mesma transação para evitar duplicatas quando há
 * mais de uma instância da API.
 */
export async function processMediaReleaseReminders(now = new Date()) {
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 1);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 31);
  windowEnd.setHours(23, 59, 59, 999);
  const pending = await prisma.mediaReleaseReminder.findMany({
    where: { notifiedAt: null, catalogItem: { releaseDate: { gte: windowStart, lte: windowEnd } } },
    include: { catalogItem: true },
    take: 500,
  });
  let sent = 0;
  for (const reminder of pending) {
    const releaseDate = reminder.catalogItem.releaseDate;
    if (!releaseDate) continue;
    const notifyAt = new Date(releaseDate);
    notifyAt.setDate(notifyAt.getDate() - reminder.remindBeforeDays);
    notifyAt.setHours(0, 0, 0, 0);
    if (now.getTime() < notifyAt.getTime()) continue;
    const releaseDay = new Date(releaseDate);
    releaseDay.setHours(0, 0, 0, 0);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const days = Math.max(0, Math.round((releaseDay.getTime() - today.getTime()) / 86_400_000));
    const entityId = `${reminder.catalogItem.provider}|${reminder.catalogItem.mediaType}|${reminder.catalogItem.externalId}`;
    try {
      const didSend = await prisma.$transaction(async tx => {
        const claim = await tx.mediaReleaseReminder.updateMany({
          where: { id: reminder.id, notifiedAt: null },
          data: { notifiedAt: now },
        });
        if (!claim.count) return false;
        await tx.notification.create({
          data: {
            recipientId: reminder.userId,
            type: 'MEDIA_RELEASE' as any,
            title: days === 0 ? 'Lançamento hoje' : `Lançamento em ${days} dia${days === 1 ? '' : 's'}`,
            body: reminder.catalogItem.title,
            entityType: 'mediaRelease',
            entityId,
          },
        });
        return true;
      });
      if (didSend) {
        sent++;
        await pushToUser(reminder.userId, 'releases', {
          title: days === 0 ? 'Lançamento hoje' : `Lançamento em ${days} dia${days === 1 ? '' : 's'}`,
          body: reminder.catalogItem.title,
          url: `/catalogo/${reminder.catalogItem.provider}/${reminder.catalogItem.mediaType}/${encodeURIComponent(reminder.catalogItem.externalId)}`,
          tag: `release-${reminder.id}`,
        }).catch(() => 0);
      }
    } catch {
      // Um lembrete com falha será tentado novamente porque a transação reverte o claim.
    }
  }
  return sent;
}
