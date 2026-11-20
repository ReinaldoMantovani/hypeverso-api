import { hashPassword as hashArgon, verifyPassword as verifyArgon } from './password.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { allowedOrigins, env, mfaRequiredForStaff } from '../config/env.js';
import { randomToken, sha256 } from './security.js';

export type Role = 'USER' | 'MODERATOR' | 'EDITOR' | 'ADMIN';
export type AccessClaims = { sub: string; email: string; role: Role; mfa?: boolean };

export const ACCESS_COOKIE = 'nv_access';
export const REFRESH_COOKIE = 'nv_refresh';
export const CSRF_COOKIE = 'nv_csrf';
export const CSRF_HEADER = 'x-csrf-token';
/** Papéis que precisam de 2FA ativo para acessar rotas administrativas. */
export const MFA_ROLES: Role[] = ['ADMIN', 'EDITOR'];

export const hashPassword = (v: string) => hashArgon(v);
export const verifyPassword = (hash: string, v: string) => verifyArgon(hash, v);

const secure = () => env.COOKIE_SECURE === 'true';

function ttlSeconds(value: string) {
  const m = /^(\d+)\s*([smhd]?)$/.exec(value.trim());
  if (!m) return 900;
  const n = Number(m[1]);
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2] || 's'] ?? 1);
}

export function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400,
  });
}

/**
 * Access token em cookie HttpOnly: o JavaScript da página não consegue lê-lo,
 * então um XSS não consegue roubar a sessão para usar em outro lugar.
 */
function setAccessCookie(reply: FastifyReply, token: string) {
  reply.setCookie(ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/api',
    maxAge: ttlSeconds(env.ACCESS_TOKEN_TTL),
  });
}

/** Double-submit CSRF: cookie legível pelo JS do próprio site + header igual. */
export function ensureCsrfCookie(request: FastifyRequest, reply: FastifyReply) {
  const current = request.cookies[CSRF_COOKIE];
  if (current && /^[A-Za-z0-9_-]{32,}$/.test(current)) return current;
  const token = randomBytes(32).toString('base64url');
  reply.setCookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400,
  });
  return token;
}

export function clearAuthCookies(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  reply.clearCookie(ACCESS_COOKIE, { path: '/api' });
}
/** @deprecated use clearAuthCookies */
export const clearRefreshCookie = clearAuthCookies;

export const isMobileClient = (request: FastifyRequest) => request.headers['x-client-platform'] === 'mobile';

/**
 * Emite access + refresh token. Para o navegador, ambos vão apenas em cookies
 * HttpOnly. O app mobile (sem cookies) recebe o access token no corpo e o
 * refresh token no header x-refresh-token, guardados no SecureStore.
 */
export async function issueTokens(
  app: FastifyInstance,
  user: { id: string; email: string; role: string },
  request: FastifyRequest,
  reply: FastifyReply,
  options: { mfa?: boolean } = {},
) {
  const mfa = Boolean(options.mfa);
  const accessToken = app.jwt.sign(
    { sub: user.id, email: user.email, role: user.role, mfa },
    { expiresIn: env.ACCESS_TOKEN_TTL as any },
  );
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400000);
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt, mfaVerified: mfa },
  });
  setRefreshCookie(reply, refreshToken);
  setAccessCookie(reply, accessToken);
  ensureCsrfCookie(request, reply);
  if (isMobileClient(request)) {
    reply.header('x-refresh-token', refreshToken);
    return accessToken;
  }
  return undefined;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const p = await request.jwtVerify<AccessClaims>();
    request.authUser = { id: p.sub, email: p.email, role: p.role, mfa: Boolean(p.mfa) };
  } catch {
    return reply.code(401).send({ error: 'Não autenticado' });
  }
}

/** Autenticação opcional: devolve o id do usuário se houver sessão válida. */
export async function optionalUser(request: FastifyRequest) {
  try {
    const p = await request.jwtVerify<AccessClaims>();
    return { id: p.sub, role: p.role, mfa: Boolean(p.mfa) };
  } catch {
    return null;
  }
}

export const requireRole =
  (...roles: ('MODERATOR' | 'EDITOR' | 'ADMIN')[]) =>
  async (request: FastifyRequest, reply: FastifyReply) => {
    await authenticate(request, reply);
    if (reply.sent) return;
    const user = request.authUser;
    if (!user || !roles.includes(user.role as any)) return reply.code(403).send({ error: 'Acesso negado' });
    // 2FA obrigatório para ADMIN/EDITOR em qualquer rota protegida por papel.
    if (mfaRequiredForStaff && MFA_ROLES.includes(user.role) && !user.mfa) {
      const row = await prisma.user.findUnique({ where: { id: user.id }, select: { totpEnabledAt: true } });
      const code = row?.totpEnabledAt ? 'MFA_REQUIRED' : 'MFA_SETUP_REQUIRED';
      return reply.code(403).send({
        error:
          code === 'MFA_REQUIRED'
            ? 'Entre novamente e confirme o código de verificação em duas etapas.'
            : 'Ative a verificação em duas etapas em Conta › Segurança para acessar a área administrativa.',
        code,
      });
    }
  };

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT = new Set(['/api/billing/webhook']);

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Proteção CSRF para requisições autenticadas por cookie. Clientes que usam
 * Authorization: Bearer (app mobile) não enviam cookies e ficam isentos.
 */
export async function csrfGuard(request: FastifyRequest, reply: FastifyReply) {
  if (!UNSAFE.has(request.method)) return;
  const path = request.url.split('?')[0];
  if (CSRF_EXEMPT.has(path)) return;
  const cookies = request.cookies || {};
  const usesCookieSession = Boolean(cookies[ACCESS_COOKIE] || cookies[REFRESH_COOKIE]);
  if (!usesCookieSession || request.headers.authorization) return;

  const origin = request.headers.origin;
  if (origin) {
    const trusted = new Set([...allowedOrigins, new URL(env.PUBLIC_WEB_URL).origin]);
    if (!trusted.has(origin)) return reply.code(403).send({ error: 'Origem não autorizada', code: 'CSRF_ORIGIN' });
  }
  const header = request.headers[CSRF_HEADER];
  const cookie = cookies[CSRF_COOKIE];
  if (typeof header !== 'string' || !cookie || !safeEqual(header, cookie)) {
    return reply.code(403).send({ error: 'Sessão de segurança expirada. Recarregue a página.', code: 'CSRF_INVALID' });
  }
}
