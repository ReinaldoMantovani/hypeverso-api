import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  authenticate,
  clearAuthCookies,
  ensureCsrfCookie,
  hashPassword,
  issueTokens,
  verifyPassword,
} from '../lib/auth.js';
import { captchaError, verifyCaptcha } from '../lib/captcha.js';
import { signToken, verifySignedToken } from '../lib/signed-token.js';
import { open } from '../lib/crypto-box.js';
import { verifyTotp } from '../lib/totp.js';
import { randomToken, sha256, slugify } from '../lib/security.js';
import { env } from '../config/env.js';
import { sendMail } from '../lib/mail.js';
import { clientIp } from '../lib/client-ip.js';
import { stringList } from '../lib/json-array.js';

// Hash fictício usado quando o e-mail não existe: mantém o tempo de resposta do
// login equivalente e dificulta enumeração de contas por timing.
let dummyHashPromise: Promise<string> | null = null;
const dummyHash = () => (dummyHashPromise ??= hashPassword(randomToken()));
const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const credentials = z.object({
  email: z
    .string()
    .email()
    .transform(v => v.toLowerCase()),
  password: z.string().min(8).max(128),
});
async function sendVerificationEmail(userId: string, email: string, name: string) {
  const raw = randomToken();
  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 24 * 3600000) },
  });
  await sendMail(
    email,
    'Confirme seu e-mail no Hypeverso',
    `<h1>Bem-vindo ao Hypeverso, ${escapeHtml(name)}</h1><p>Confirme seu e-mail para comentar e publicar na comunidade:</p><p><a href="${env.PUBLIC_WEB_URL}/verify-email?token=${raw}">Confirmar e-mail</a></p><p>O link vale por 24 horas.</p>`,
  );
}

const authRoutes: FastifyPluginAsync = async app => {
  app.post('/register', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(100),
        username: z
          .string()
          .min(3)
          .max(30)
          .regex(/^[a-zA-Z0-9_]+$/),
        email: z.string().email().max(254),
        password: z.string().min(8).max(128),
        acceptTerms: z.literal(true, { message: 'É necessário aceitar os Termos de Uso e a Política de Privacidade.' }),
        captchaToken: z.string().max(2048).optional(),
      })
      .parse(req.body);
    if (!(await verifyCaptcha(body.captchaToken, clientIp(req)))) throw captchaError();
    const email = body.email.toLowerCase();
    const username = slugify(body.username).replace(/-/g, '_');
    const exists = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
    if (exists) return reply.code(409).send({ error: 'Email ou usuário já cadastrado' });
    const user = await prisma.user.create({
      data: {
        name: body.name,
        username,
        email,
        passwordHash: await hashPassword(body.password),
        termsAcceptedAt: new Date(),
        termsVersion: env.LEGAL_TERMS_VERSION,
        subscription: { create: {} },
      },
      select: { id: true, name: true, username: true, email: true, role: true, level: true, xp: true, avatarUrl: true },
    });
    await sendVerificationEmail(user.id, email, body.name);
    const accessToken = await issueTokens(app, user, req, reply);
    return reply.code(201).send({ user: { ...user, emailVerifiedAt: null }, ...(accessToken ? { accessToken } : {}) });
  });

  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = credentials.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email }, include: { subscription: true } });
    if (!user) {
      await verifyPassword(await dummyHash(), body.password).catch(() => false);
      return reply.code(401).send({ error: 'Credenciais inválidas' });
    }
    if (!(await verifyPassword(user.passwordHash, body.password)))
      return reply.code(401).send({ error: 'Credenciais inválidas' });
    if (user.status !== 'ACTIVE') return reply.code(403).send({ error: 'Conta indisponível' });
    if (user.totpEnabledAt) {
      // Segunda etapa: senha correta, mas a sessão só é emitida após o código TOTP.
      const mfaToken = signToken({ purpose: 'mfa-login', sub: user.id }, 300);
      return { mfaRequired: true, mfaToken };
    }
    const accessToken = await issueTokens(app, user, req, reply);
    return {
      ...(accessToken ? { accessToken } : {}),
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        level: user.level,
        xp: user.xp,
        avatarUrl: user.avatarUrl,
        emailVerifiedAt: user.emailVerifiedAt,
        subscription: user.subscription,
        mfaEnabled: Boolean(user.totpEnabledAt),
      },
    };
  });

  // Segunda etapa do login com 2FA: código TOTP (6 dígitos) ou código de recuperação.
  app.post('/mfa/verify', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const body = z
      .object({ mfaToken: z.string().min(10).max(1000), code: z.string().trim().min(6).max(20) })
      .parse(req.body);
    const challenge = verifySignedToken<{ sub: string }>(body.mfaToken, 'mfa-login');
    if (!challenge) return reply.code(401).send({ error: 'O desafio expirou. Entre novamente.', code: 'MFA_EXPIRED' });
    const user = await prisma.user.findUnique({ where: { id: challenge.sub }, include: { subscription: true } });
    if (!user || user.status !== 'ACTIVE' || !user.totpSecret)
      return reply.code(401).send({ error: 'Não foi possível validar o código.' });

    let ok = false;
    if (/^\d{6}$/.test(body.code.replace(/\s+/g, ''))) {
      const step = verifyTotp(open(user.totpSecret), body.code, user.totpLastStep);
      if (step != null) {
        // updateMany condicional impede o mesmo código em duas requisições paralelas.
        const claimed = await prisma.user.updateMany({
          where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
          data: { totpLastStep: step },
        });
        ok = claimed.count === 1;
      }
    } else {
      const hash = sha256(body.code.toLowerCase().replace(/\s+/g, ''));
      const codes = stringList(user.totpRecoveryCodes);
      if (codes.includes(hash)) {
        await prisma.user.update({
          where: { id: user.id },
          data: { totpRecoveryCodes: codes.filter(c => c !== hash) },
        });
        ok = true;
        req.log.warn({ userId: user.id }, 'Login com código de recuperação de 2FA');
      }
    }
    if (!ok) return reply.code(401).send({ error: 'Código inválido.', code: 'MFA_INVALID' });

    const accessToken = await issueTokens(app, user, req, reply, { mfa: true });
    return {
      ...(accessToken ? { accessToken } : {}),
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        level: user.level,
        xp: user.xp,
        avatarUrl: user.avatarUrl,
        emailVerifiedAt: user.emailVerifiedAt,
        subscription: user.subscription,
        mfaEnabled: true,
      },
    };
  });

  // Inicializa o cookie CSRF (double-submit) para o navegador.
  app.get('/csrf', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return { csrfToken: ensureCsrfCookie(req, reply) };
  });

  app.post(
    '/resend-verification',
    { preHandler: authenticate, config: { rateLimit: { max: 3, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: req.authUser!.id },
        select: { id: true, email: true, name: true, emailVerifiedAt: true },
      });
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' });
      if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
      await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
      await sendVerificationEmail(user.id, user.email, user.name);
      return { ok: true };
    },
  );

  app.post('/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    const raw = body.refreshToken || req.cookies.nv_refresh;
    if (!raw) return reply.code(401).send({ error: 'Refresh token ausente' });
    const token = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
    if (token?.revokedAt && Date.now() - token.revokedAt.getTime() > 30_000) {
      // Reuso de refresh token já rotacionado = provável roubo. Encerra todas as sessões do usuário.
      await prisma.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      req.log.warn({ userId: token.userId }, 'Reuso de refresh token detectado; sessões revogadas');
    }
    if (!token || token.revokedAt || token.expiresAt < new Date() || token.user.status !== 'ACTIVE') {
      clearAuthCookies(reply);
      return reply.code(401).send({ error: 'Sessão expirada' });
    }
    await prisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    // O status de 2FA da sessão é preservado na rotação do refresh token.
    const accessToken = await issueTokens(app, token.user, req, reply, { mfa: token.mfaVerified });
    return accessToken ? { accessToken } : { ok: true };
  });

  app.post('/logout', async (req, reply) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    const raw = body.refreshToken || req.cookies.nv_refresh;
    if (raw)
      await prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(raw), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    clearAuthCookies(reply);
    return reply.code(204).send();
  });

  app.post('/verify-email', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    const row = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.expiresAt < new Date()) return reply.code(400).send({ error: 'Token inválido ou expirado' });
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
      prisma.emailVerificationToken.deleteMany({ where: { userId: row.userId } }),
    ]);
    return { ok: true };
  });

  app.post('/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async req => {
    const { email, captchaToken } = z
      .object({ email: z.string().email().max(254), captchaToken: z.string().max(2048).optional() })
      .parse(req.body);
    if (!(await verifyCaptcha(captchaToken, clientIp(req)))) throw captchaError();
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user) {
      const raw = randomToken();
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 3600000) },
      });
      await sendMail(
        user.email,
        'Recuperação de senha Hypeverso',
        `<p><a href="${env.PUBLIC_WEB_URL}/reset-password?token=${raw}">Criar nova senha</a></p>`,
      );
    }
    return { ok: true };
  });
  app.post('/reset-password', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { token, password } = z
      .object({ token: z.string().min(20).max(200), password: z.string().min(8).max(128) })
      .parse(req.body);
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date())
      return reply.code(400).send({ error: 'Token inválido ou expirado' });
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password) } }),
      prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { ok: true };
  });
};
export default authRoutes;
