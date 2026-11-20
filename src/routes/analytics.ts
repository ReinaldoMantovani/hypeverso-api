import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
const analyticsRoutes: FastifyPluginAsync = async app => {
  app.post('/analytics/event', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z
      .object({
        type: z
          .string()
          .min(2)
          .max(80)
          .regex(/^[A-Za-z0-9_.:-]+$/),
        path: z.string().max(300).optional(),
        referrer: z.string().max(500).optional(),
        postId: z.string().max(40).optional(),
        metadata: z
          .record(z.string().max(60), z.union([z.string().max(300), z.number(), z.boolean(), z.null()]))
          .refine(m => Object.keys(m).length <= 20, 'metadata muito grande')
          .optional(),
      })
      .parse(req.body);
    let userId: string | undefined;
    try {
      const p = await req.jwtVerify<{ sub: string }>();
      userId = p.sub;
    } catch {}
    await prisma.analyticsEvent.create({ data: { ...b, userId } });
    return reply.code(202).send({ ok: true });
  });
};
export default analyticsRoutes;
