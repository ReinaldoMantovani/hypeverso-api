import { prisma } from './db.js';
import { buildApp } from './app.js';
import { startAiNewsWorker, stopAiNewsWorker } from './services/ai-news.js';
import { bullEnabled } from './lib/bullmq.js';
import { env } from './config/env.js';
import { delCache, redis } from './lib/redis.js';
import { notifyNewsPublished, processMediaReleaseReminders } from './services/notifications.js';
import { syncPostToSearchIndex } from './services/search-index.js';
import { flushViews } from './services/views.js';
import { isNewsletterSlot, sendWeeklyDigest } from './services/newsletter.js';

const app = await buildApp();

// Fastify captura exceções de rota, mas rejeições assíncronas fora do ciclo HTTP
// (timers, integrações, Redis etc.) não devem derrubar silenciosamente a API.
process.on('unhandledRejection', reason => {
  app.log.error({ err: reason }, 'Unhandled promise rejection; API continuará ativa');
});
process.on('uncaughtException', error => {
  app.log.fatal({ err: error }, 'Uncaught exception; o container será reiniciado pelo Docker');
  setTimeout(() => process.exit(1), 500).unref();
});

try {
  await prisma.$connect();
  try {
    await redis.connect();
  } catch (error) {
    app.log.warn({ err: error }, 'Redis indisponível na inicialização; API continuará sem cache até reconectar');
  }

  // IDs de categorias podem mudar quando o banco é recriado; nunca mantenha IDs antigos no Redis.
  await delCache('categories').catch(error =>
    app.log.warn({ err: error }, 'Não foi possível limpar cache de categorias'),
  );
  await delCache('posts:*').catch(error => app.log.warn({ err: error }, 'Não foi possível limpar cache de posts'));

  if (!bullEnabled()) {
    const publishScheduled = async () => {
      try {
        const due = await prisma.post.findMany({
          where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
          select: { id: true, publishedAt: true },
          take: 100,
        });
        for (const row of due) {
          const updated = await prisma.post.updateMany({
            where: { id: row.id, status: 'SCHEDULED' },
            data: { status: 'PUBLISHED', publishedAt: row.publishedAt ?? new Date() },
          });
          if (updated.count) {
            if (!row.publishedAt)
              await notifyNewsPublished(row.id).catch(error =>
                app.log.error({ err: error, postId: row.id }, 'Falha ao notificar publicação agendada'),
              );
            void syncPostToSearchIndex(row.id).catch(error =>
              app.log.warn(
                { err: error, postId: row.id },
                'Publicação agendada ficará para a próxima reconciliação da busca',
              ),
            );
          }
        }
        if (due.length) await delCache('posts:*').catch(() => undefined);
      } catch (error) {
        app.log.error({ err: error }, 'Falha ao publicar posts agendados; a API continuará ativa');
      }
    };

    await publishScheduled();
    setInterval(() => void publishScheduled(), 60_000).unref();

    const processReleaseReminders = async () => {
      try {
        const sent = await processMediaReleaseReminders();
        if (sent) app.log.info({ sent }, 'Lembretes de lançamentos enviados');
      } catch (error) {
        app.log.error({ err: error }, 'Falha ao processar lembretes de lançamentos; a API continuará ativa');
      }
    };
    await processReleaseReminders();
    setInterval(() => void processReleaseReminders(), 15 * 60_000).unref();

    // Newsletter semanal sem BullMQ: verifica a cada 10 min se é o dia/hora configurados.
    setInterval(() => {
      if (isNewsletterSlot())
        void sendWeeklyDigest(app.log).catch(error => app.log.error({ err: error }, 'Falha na newsletter'));
    }, 10 * 60_000).unref();
  } else {
    app.log.info('BullMQ Community ativo: publicações agendadas e lembretes serão processados pelo queue-worker');
  }

  // Fora do Docker o worker ainda pode ser executado embutido. No Compose a API
  // recebe AI_NEWS_WORKER_ENABLED=false e o serviço ai-worker processa a fila.
  if (!bullEnabled()) startAiNewsWorker();
  else app.log.info('BullMQ Community ativo: AI News será processado pelo ai-worker');
  // Grava em lote as visualizações acumuladas no Redis.
  setInterval(() => void flushViews(app.log), env.VIEW_FLUSH_MS).unref();
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

const shutdown = async () => {
  stopAiNewsWorker();
  await flushViews(app.log).catch(() => 0);
  await app.close();
  await prisma.$disconnect();
  try {
    redis.disconnect();
  } catch {}
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
