import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../lib/auth.js';
import { bullEnabled, getBullQueue, queueNames, queueSnapshot, type QueueKey } from '../lib/bullmq.js';

const queueKeySchema = z.enum(['aiNews', 'system', 'discovery']);
const stateSchema = z.enum(['failed', 'waiting', 'active', 'delayed', 'completed', 'prioritized']);

const queueRoutes: FastifyPluginAsync = async app => {
  const admin = async (req: any, reply: any) => requireRole('ADMIN')(req, reply);

  app.get('/admin/queues', { preHandler: admin }, async () => {
    if (!bullEnabled()) return { enabled: false, mode: 'legacy', queues: [] };
    const queues = await Promise.all((Object.keys(queueNames) as QueueKey[]).map(key => queueSnapshot(key)));
    return { enabled: true, mode: 'bullmq-community', pro: false, queues };
  });

  app.get('/admin/queues/:queue/jobs', { preHandler: admin }, async req => {
    const { queue } = z.object({ queue: queueKeySchema }).parse(req.params);
    const q = z
      .object({ state: stateSchema.default('failed'), limit: z.coerce.number().int().min(1).max(100).default(30) })
      .parse(req.query);
    const bullState = q.state === 'waiting' ? 'wait' : q.state;
    const jobs = await getBullQueue(queue).getJobs([bullState as any], 0, q.limit - 1, false);
    return jobs.map(job => ({
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      attempts: job.opts.attempts || 1,
      failedReason: job.failedReason || null,
      timestamp: job.timestamp,
      processedOn: job.processedOn || null,
      finishedOn: job.finishedOn || null,
      state: q.state,
    }));
  });

  app.post('/admin/queues/:queue/jobs/:jobId/retry', { preHandler: admin }, async (req, reply) => {
    const { queue, jobId } = z.object({ queue: queueKeySchema, jobId: z.string().min(1) }).parse(req.params);
    const job = await getBullQueue(queue).getJob(jobId);
    if (!job) return reply.code(404).send({ error: 'Job não encontrado' });
    try {
      await job.retry();
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
    return { ok: true };
  });

  app.delete('/admin/queues/:queue/jobs/:jobId', { preHandler: admin }, async (req, reply) => {
    const { queue, jobId } = z.object({ queue: queueKeySchema, jobId: z.string().min(1) }).parse(req.params);
    const job = await getBullQueue(queue).getJob(jobId);
    if (!job) return reply.send({ ok: true, removed: false });
    try {
      await job.remove();
      return { ok: true, removed: true };
    } catch (error) {
      return reply.code(409).send({
        error: 'Jobs ativos não podem ser removidos até liberarem o lock.',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post('/admin/queues/:queue/pause', { preHandler: admin }, async req => {
    const { queue } = z.object({ queue: queueKeySchema }).parse(req.params);
    await getBullQueue(queue).pause();
    return { ok: true, paused: true };
  });

  app.post('/admin/queues/:queue/resume', { preHandler: admin }, async req => {
    const { queue } = z.object({ queue: queueKeySchema }).parse(req.params);
    await getBullQueue(queue).resume();
    return { ok: true, paused: false };
  });

  app.delete('/admin/queues/:queue/failed', { preHandler: admin }, async req => {
    const { queue } = z.object({ queue: queueKeySchema }).parse(req.params);
    const removed = await getBullQueue(queue).clean(0, 1000, 'failed');
    return { ok: true, removed: removed.length };
  });
};

export default queueRoutes;
