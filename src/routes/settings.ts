import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../lib/auth.js';
import { getAllSettings, getPublicSettings, saveSetting, settingSchemas, type SettingKey } from '../services/settings.js';

const settingsRoutes: FastifyPluginAsync = async app => {
  const editor = async (req: any, reply: any) => requireRole('EDITOR', 'ADMIN')(req, reply);
  const admin = async (req: any, reply: any) => requireRole('ADMIN')(req, reply);

  app.get('/settings/public', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300');
    return getPublicSettings();
  });

  app.get('/admin/settings', { preHandler: editor }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return getAllSettings();
  });

  app.put('/admin/settings/:key', { preHandler: admin }, async req => {
    const { key } = z
      .object({ key: z.enum(Object.keys(settingSchemas) as [SettingKey, ...SettingKey[]]) })
      .parse(req.params);
    return { key, value: await saveSetting(key, req.body ?? {}) };
  });
};
export default settingsRoutes;
