import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRole } from '../lib/auth.js';
import { env } from '../config/env.js';
import { getActiveAiModel, getAiNewsHealth } from '../services/ai-news.js';
import { enqueueAiNewsJob, removeAiNewsQueueJob } from '../lib/bullmq.js';

const aiNewsRoutes: FastifyPluginAsync = async app => {
  const editor = async (req: any, reply: any) => requireRole('EDITOR', 'ADMIN')(req, reply);

  app.get('/admin/ai-news/health', { preHandler: editor }, async () => getAiNewsHealth());

  app.post('/admin/ai-news/repair', { preHandler: editor }, async (_req, reply) => {
    try {
      const target = new URL('/repair', env.AI_NEWS_WORKER_HEALTH_URL).toString();
      const response = await fetch(target, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return reply.code(503).send({ error: 'O worker ainda não respondeu ao reparo', detail: body });
      return reply.code(202).send({
        ok: true,
        message: 'Reparo solicitado. O worker está revalidando Ollama, modelo e busca.',
        worker: body,
      });
    } catch (error) {
      return reply.code(503).send({
        error: 'Não foi possível acionar o worker de IA. O Docker continuará tentando reiniciá-lo automaticamente.',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/admin/ai-news/jobs', { preHandler: editor }, async req => {
    const q = z.object({ limit: z.coerce.number().min(1).max(100).default(30) }).parse(req.query);
    return prisma.aiNewsJob.findMany({
      where: { hiddenAt: null },
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        requestedBy: { select: { id: true, name: true, username: true } },
        drafts: {
          include: {
            post: { select: { id: true, title: true, slug: true, status: true, coverImageUrl: true, updatedAt: true } },
            sources: { select: { id: true, title: true, url: true, publisher: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  });

  app.get('/admin/ai-news/drafts/:postId', { preHandler: editor }, async (req, reply) => {
    const { postId } = z.object({ postId: z.string() }).parse(req.params);
    const draft = await prisma.aiNewsDraft.findUnique({
      where: { postId },
      include: {
        sources: { orderBy: { createdAt: 'asc' } },
        job: { select: { id: true, model: true, query: true, timeRange: true, createdAt: true } },
      },
    });
    if (!draft) return reply.code(404).send({ error: 'Este conteúdo não foi gerado pelo AI News Studio' });
    return draft;
  });

  app.post('/admin/ai-news/jobs', { preHandler: editor }, async (req, reply) => {
    const body = z
      .object({
        categoryId: z.string().optional().nullable(),
        query: z.string().trim().min(2).max(180).optional().nullable(),
        requestedDrafts: z.coerce.number().int().min(1).max(5).default(1),
        timeRange: z.enum(['day', 'week', 'month']).default('day'),
        language: z.literal('pt-BR').default('pt-BR'),
      })
      .parse(req.body);
    if (body.categoryId) {
      const category = await prisma.category.findUnique({ where: { id: body.categoryId }, select: { id: true } });
      if (!category) return reply.code(400).send({ error: 'Categoria inválida' });
    }
    const job = await prisma.aiNewsJob.create({
      data: {
        requestedById: req.authUser!.id,
        categoryId: body.categoryId || null,
        query: body.query || null,
        requestedDrafts: body.requestedDrafts,
        language: body.language,
        timeRange: body.timeRange,
        model: getActiveAiModel(),
        stageMessage: 'Aguardando BullMQ',
      },
    });
    try {
      await enqueueAiNewsJob(job.id);
    } catch (error) {
      await prisma.aiNewsJob
        .update({
          where: { id: job.id },
          data: {
            stageMessage: 'Redis/BullMQ temporariamente indisponível; o reconciliador tentará novamente',
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch(() => undefined);
    }
    return reply.code(202).send(job);
  });

  app.post('/admin/ai-news/jobs/:id/retry', { preHandler: editor }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const current = await prisma.aiNewsJob.findFirst({ where: { id, hiddenAt: null } });
    if (!current) return reply.code(404).send({ error: 'Processamento não encontrado' });
    if (current.status === 'PROCESSING')
      return reply.code(409).send({ error: 'Este processamento ainda está em andamento' });
    const job = await prisma.aiNewsJob.update({
      where: { id },
      data: {
        status: 'PENDING',
        stage: 'QUEUED',
        stageMessage: 'Aguardando nova tentativa no BullMQ',
        progress: 0,
        error: null,
        startedAt: null,
        finishedAt: null,
        lastHeartbeatAt: null,
        cancelRequestedAt: null,
        hiddenAt: null,
        model: getActiveAiModel(),
      },
    });
    await removeAiNewsQueueJob(id).catch(() => false);
    await enqueueAiNewsJob(id).catch(async error => {
      await prisma.aiNewsJob
        .update({
          where: { id },
          data: {
            stageMessage: 'BullMQ indisponível; nova tentativa será reconciliada automaticamente',
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch(() => undefined);
    });
    return reply.code(202).send(job);
  });

  app.post('/admin/ai-news/jobs/:id/cancel', { preHandler: editor }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const current = await prisma.aiNewsJob.findFirst({ where: { id, hiddenAt: null } });
    if (!current) return reply.code(404).send({ error: 'Processamento não encontrado' });
    if (['COMPLETED', 'FAILED', 'CANCELED'].includes(current.status)) {
      return reply.send(current);
    }
    const now = new Date();
    await prisma.aiNewsJob.updateMany({
      where: { id, hiddenAt: null, status: { in: ['PENDING', 'PROCESSING'] } },
      data: {
        status: 'CANCELED',
        stage: 'CANCELED',
        stageMessage: 'Processamento cancelado pelo usuário',
        cancelRequestedAt: now,
        finishedAt: now,
        lastHeartbeatAt: now,
        error: null,
      },
    });
    await removeAiNewsQueueJob(id).catch(() => false);
    const job = await prisma.aiNewsJob.findUnique({ where: { id } });
    if (!job || job.hiddenAt) return reply.code(404).send({ error: 'Processamento não encontrado' });
    return reply.send(job);
  });

  const removeJob = async (req: any, reply: any) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const now = new Date();

    // Primeiro escondemos o registro. Essa operação é idempotente e já garante
    // que o card desapareça da próxima leitura, mesmo que o worker esteja no meio
    // de uma etapa. O worker sempre filtra hiddenAt/cancelRequestedAt.
    const hidden = await prisma.aiNewsJob.updateMany({
      where: { id, hiddenAt: null },
      data: { hiddenAt: now, cancelRequestedAt: now, lastHeartbeatAt: now },
    });

    // Se ainda estava ativo, finalize como cancelado. É uma segunda escrita curta,
    // fora de transação; se o job já estava FAILED/COMPLETED ela simplesmente não faz nada.
    await prisma.aiNewsJob
      .updateMany({
        where: { id, status: { in: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'CANCELED',
          stage: 'CANCELED',
          stageMessage: 'Processamento removido da fila pelo usuário',
          finishedAt: now,
          error: null,
        },
      })
      .catch(() => undefined);

    await removeAiNewsQueueJob(id).catch(() => false);
    // Remover é propositalmente idempotente: clicar duas vezes ou tentar limpar um
    // job que o servidor já ocultou nunca deve virar erro na interface.
    return reply.send({ ok: true, id, removed: hidden.count > 0 });
  };

  app.patch('/admin/ai-news/jobs/:id/remove', { preHandler: editor }, removeJob);
  app.post('/admin/ai-news/jobs/:id/remove', { preHandler: editor }, removeJob);
  app.delete('/admin/ai-news/jobs/:id', { preHandler: editor }, removeJob);

  app.patch('/admin/ai-news/jobs/cleanup', { preHandler: editor }, async (_req, reply) => {
    const now = new Date();
    const rows = await prisma.aiNewsJob.findMany({
      where: { hiddenAt: null, status: { in: ['FAILED', 'CANCELED'] } },
      select: { id: true },
      take: 500,
    });
    const ids = rows.map(row => row.id);
    const result = ids.length
      ? await prisma.aiNewsJob.updateMany({
          where: { id: { in: ids } },
          data: { hiddenAt: now, cancelRequestedAt: now, lastHeartbeatAt: now },
        })
      : { count: 0 };
    await Promise.allSettled(ids.map(id => removeAiNewsQueueJob(id)));
    return reply.send({ ok: true, removed: result.count });
  });
};

export default aiNewsRoutes;
