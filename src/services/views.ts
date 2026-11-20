import { createHash } from 'node:crypto';
import { prisma } from '../db.js';
import { redis } from '../lib/redis.js';

/**
 * Visualizações de artigos agregadas no Redis e gravadas em lote no Postgres.
 * Antes: 1–2 INSERTs por pageview. Agora: um INCR no Redis por visualização
 * única (deduplicada por 30 min por visitante) e um flush periódico.
 */
const PENDING = 'views:pending';
const EVENTS = 'views:events';
const DEDUPE_SECONDS = 30 * 60;
const MAX_EVENTS_PER_FLUSH = 5000;

export function viewerKey(userId: string | undefined, ip: string, userAgent = '') {
  if (userId) return `u:${userId}`;
  const day = new Date().toISOString().slice(0, 10);
  // Hash diário de IP+UA: não guardamos o IP, só uma chave anônima temporária.
  return `a:${createHash('sha256').update(`${day}|${ip}|${userAgent}`).digest('hex').slice(0, 24)}`;
}

export async function recordPostView(input: { postId: string; userId?: string; viewer: string; path?: string }) {
  try {
    const fresh = await redis.set(`views:seen:${input.postId}:${input.viewer}`, '1', 'EX', DEDUPE_SECONDS, 'NX');
    if (!fresh) return { counted: false };
    await redis
      .multi()
      .hincrby(PENDING, input.postId, 1)
      .rpush(
        EVENTS,
        JSON.stringify({ p: input.postId, u: input.userId || null, path: input.path || null, t: Date.now() }),
      )
      .exec();
    return { counted: true };
  } catch {
    // Redis indisponível: grava direto para não perder a métrica.
    await prisma.$transaction([
      prisma.post.updateMany({ where: { id: input.postId }, data: { viewCount: { increment: 1 } } }),
      prisma.analyticsEvent.create({
        data: { userId: input.userId, postId: input.postId, type: 'POST_VIEW', path: input.path },
      }),
      ...(input.userId
        ? [
            prisma.userInteraction.create({
              data: { userId: input.userId, postId: input.postId, type: 'VIEW', weight: 1 },
            }),
          ]
        : []),
    ]);
    return { counted: true };
  }
}

let flushing = false;
export async function flushViews(log?: { warn: (...a: any[]) => void; info?: (...a: any[]) => void }) {
  if (flushing) return 0;
  flushing = true;
  let total = 0;
  try {
    // Contadores: RENAME atômico evita perder incrementos que chegam durante o flush.
    const batchKey = `${PENDING}:flush:${Date.now()}:${process.pid}`;
    const renamed = await redis.rename(PENDING, batchKey).then(
      () => true,
      () => false,
    );
    if (renamed) {
      const counts = await redis.hgetall(batchKey);
      const entries = Object.entries(counts).filter(([, n]) => Number(n) > 0);
      for (let i = 0; i < entries.length; i += 100) {
        const chunk = entries.slice(i, i + 100);
        await prisma.$transaction(
          chunk.map(([id, n]) =>
            prisma.post.updateMany({ where: { id }, data: { viewCount: { increment: Number(n) } } }),
          ),
        );
        total += chunk.reduce((sum, [, n]) => sum + Number(n), 0);
      }
      await redis.unlink(batchKey);
    }

    // Eventos de analytics + histórico de leitura em lote.
    const raw = (await redis.lpop(EVENTS, MAX_EVENTS_PER_FLUSH)) || [];
    if (raw.length) {
      const events = raw
        .map(r => {
          try {
            return JSON.parse(r) as { p: string; u: string | null; path: string | null; t: number };
          } catch {
            return null;
          }
        })
        .filter((e): e is { p: string; u: string | null; path: string | null; t: number } => !!e);
      const validIds = new Set(
        (
          await prisma.post.findMany({
            where: { id: { in: [...new Set(events.map(e => e.p))] } },
            select: { id: true },
          })
        ).map(r => r.id),
      );
      const valid = events.filter(e => validIds.has(e.p));
      if (valid.length) {
        await prisma.analyticsEvent.createMany({
          data: valid.map(e => ({
            type: 'POST_VIEW',
            postId: e.p,
            userId: e.u,
            path: e.path,
            createdAt: new Date(e.t),
          })),
        });
        const interactions = valid.filter(e => e.u);
        if (interactions.length)
          await prisma.userInteraction.createMany({
            data: interactions.map(e => ({
              userId: e.u!,
              postId: e.p,
              type: 'VIEW',
              weight: 1,
              createdAt: new Date(e.t),
            })),
            skipDuplicates: true,
          });
      }
    }
    return total;
  } catch (error) {
    log?.warn({ err: error }, 'Falha ao gravar visualizações em lote; nova tentativa no próximo ciclo');
    return 0;
  } finally {
    flushing = false;
  }
}
