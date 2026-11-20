import webpush from 'web-push';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { stringList } from '../lib/json-array.js';

export const pushEnabled = () => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (pushEnabled()) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

// Só aceitamos endpoints dos serviços de push dos navegadores: o servidor faz
// POST para essa URL, então um endpoint arbitrário seria um vetor de SSRF.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /(^|\.)push\.apple\.com$/,
];
export function isAllowedPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some(re => re.test(u.hostname));
  } catch {
    return false;
  }
}

export type PushPayload = { title: string; body?: string; url?: string; image?: string | null; tag?: string };

async function deliver(subs: { id: string; endpoint: string; p256dh: string; auth: string }[], payload: PushPayload) {
  if (!pushEnabled() || !subs.length) return 0;
  const body = JSON.stringify(payload);
  let sent = 0;
  for (let i = 0; i < subs.length; i += 50) {
    const chunk = subs.slice(i, i + 50);
    await Promise.all(
      chunk.map(async sub => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            {
              TTL: 6 * 3600,
              urgency: 'normal',
              timeout: 10000,
            },
          );
          sent++;
          await prisma.pushSubscription
            .update({ where: { id: sub.id }, data: { lastUsedAt: new Date(), failures: 0 } })
            .catch(() => undefined);
        } catch (error: any) {
          const status = Number(error?.statusCode || 0);
          if (status === 404 || status === 410)
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          else
            await prisma.pushSubscription
              .update({ where: { id: sub.id }, data: { failures: { increment: 1 } } })
              .catch(() => undefined);
        }
      }),
    );
  }
  // Remove inscrições que falham repetidamente.
  await prisma.pushSubscription.deleteMany({ where: { failures: { gte: 10 } } }).catch(() => undefined);
  return sent;
}

/** Notícia publicada: inscritos em "news" (todas) ou na categoria específica. */
export async function pushNewsPublished(post: {
  title: string;
  slug: string;
  categoryId: string;
  categoryName: string;
  coverImageUrl?: string | null;
}) {
  if (!pushEnabled()) return 0;
  // Tópicos ficam em JSON no MySQL: filtramos em memória (lista de inscrições é pequena).
  const all = await prisma.pushSubscription.findMany({
    select: { id: true, endpoint: true, p256dh: true, auth: true, topics: true },
    take: 50000,
  });
  const subs = all.filter(s => {
    const topics = stringList(s.topics);
    return topics.includes('news') || topics.includes(`cat:${post.categoryId}`);
  });
  return deliver(subs, {
    title: `Nova em ${post.categoryName}`,
    body: post.title,
    url: `/post/${post.slug}`,
    image: post.coverImageUrl && /^https:\/\//.test(post.coverImageUrl) ? post.coverImageUrl : null,
    tag: `post-${post.slug}`,
  });
}

/** Lembrete de lançamento para os dispositivos do usuário inscritos em "releases". */
export async function pushToUser(userId: string, topic: string, payload: PushPayload) {
  if (!pushEnabled()) return 0;
  const subs = (
    await prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true, topics: true },
    })
  ).filter(s => stringList(s.topics).includes(topic));
  return deliver(subs, payload);
}
