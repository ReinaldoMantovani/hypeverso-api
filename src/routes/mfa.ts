import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { prisma } from '../db.js';
import { authenticate, issueTokens, MFA_ROLES, verifyPassword } from '../lib/auth.js';
import { open, seal } from '../lib/crypto-box.js';
import { generateRecoveryCodes, generateTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp.js';
import { sha256 } from '../lib/security.js';
import { env, mfaRequiredForStaff } from '../config/env.js';
import { stringList } from '../lib/json-array.js';

// Gerenciamento da verificação em duas etapas (TOTP) da própria conta.
const mfaRoutes: FastifyPluginAsync = async app => {
  const limited = { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } };

  app.get('/me/mfa', { preHandler: authenticate }, async req => {
    const user = await prisma.user.findUnique({
      where: { id: req.authUser!.id },
      select: { totpEnabledAt: true, totpRecoveryCodes: true, role: true },
    });
    return {
      enabled: Boolean(user?.totpEnabledAt),
      enabledAt: user?.totpEnabledAt ?? null,
      recoveryCodesLeft: stringList(user?.totpRecoveryCodes).length,
      required: mfaRequiredForStaff && MFA_ROLES.includes((user?.role || 'USER') as any),
      sessionVerified: Boolean(req.authUser!.mfa),
    };
  });

  // Passo 1: gera um segredo pendente e o QR Code para o app autenticador.
  app.post('/me/mfa/setup', limited, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.authUser!.id },
      select: { email: true, totpEnabledAt: true },
    });
    if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' });
    if (user.totpEnabledAt) return reply.code(409).send({ error: 'A verificação em duas etapas já está ativa.' });
    const secret = generateTotpSecret();
    await prisma.user.update({ where: { id: req.authUser!.id }, data: { totpPendingSecret: seal(secret) } });
    const url = otpauthUrl(secret, user.email, env.MFA_ISSUER);
    const qrCode = await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
    reply.header('cache-control', 'no-store');
    return { secret, otpauthUrl: url, qrCode };
  });

  // Passo 2: confirma o primeiro código, ativa o 2FA e devolve os códigos de recuperação (uma única vez).
  app.post('/me/mfa/enable', limited, async (req, reply) => {
    const { code } = z.object({ code: z.string().trim().min(6).max(10) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.authUser!.id } });
    if (!user?.totpPendingSecret) return reply.code(400).send({ error: 'Inicie a configuração novamente.' });
    const secret = open(user.totpPendingSecret);
    const step = verifyTotp(secret, code);
    if (step == null)
      return reply.code(400).send({ error: 'Código inválido. Confira o horário do celular.', code: 'MFA_INVALID' });
    const recoveryCodes = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret: seal(secret),
        totpPendingSecret: null,
        totpEnabledAt: new Date(),
        totpLastStep: step,
        totpRecoveryCodes: recoveryCodes.map(c => sha256(c)),
      },
    });
    // Encerra as outras sessões e emite uma nova já verificada.
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await issueTokens(app, user, req, reply, { mfa: true });
    req.log.info({ userId: user.id }, '2FA ativado');
    reply.header('cache-control', 'no-store');
    return { enabled: true, recoveryCodes };
  });

  app.post('/me/mfa/recovery-codes', limited, async (req, reply) => {
    const { code } = z.object({ code: z.string().trim().min(6).max(10) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.authUser!.id } });
    if (!user?.totpSecret) return reply.code(400).send({ error: 'A verificação em duas etapas não está ativa.' });
    const step = verifyTotp(open(user.totpSecret), code, user.totpLastStep);
    if (step == null) return reply.code(400).send({ error: 'Código inválido.', code: 'MFA_INVALID' });
    const recoveryCodes = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpLastStep: step, totpRecoveryCodes: recoveryCodes.map(c => sha256(c)) },
    });
    reply.header('cache-control', 'no-store');
    return { recoveryCodes };
  });

  app.post('/me/mfa/disable', limited, async (req, reply) => {
    const { password, code } = z
      .object({ password: z.string().min(1).max(128), code: z.string().trim().min(6).max(10) })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.authUser!.id } });
    if (!user?.totpSecret) return reply.code(400).send({ error: 'A verificação em duas etapas não está ativa.' });
    if (mfaRequiredForStaff && MFA_ROLES.includes(user.role as any))
      return reply.code(403).send({ error: 'Contas de administração e edição precisam manter o 2FA ativo.' });
    if (!(await verifyPassword(user.passwordHash, password))) return reply.code(403).send({ error: 'Senha incorreta' });
    if (verifyTotp(open(user.totpSecret), code, user.totpLastStep) == null)
      return reply.code(400).send({ error: 'Código inválido.', code: 'MFA_INVALID' });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret: null,
        totpPendingSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        totpRecoveryCodes: [],
      },
    });
    req.log.warn({ userId: user.id }, '2FA desativado');
    return { enabled: false };
  });
};
export default mfaRoutes;
