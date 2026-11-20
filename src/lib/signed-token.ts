import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

// Token curto assinado (HMAC-SHA256) para etapas intermediárias, como o desafio
// de 2FA. Usa chave própria — nunca é aceito como access token.
const secret = `signed-token:${env.JWT_REFRESH_SECRET}`;

export function signToken(payload: Record<string, unknown>, ttlSeconds: number) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
    'base64url',
  );
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySignedToken<T extends Record<string, unknown>>(token: string, purpose: string): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (data.purpose !== purpose || typeof data.exp !== 'number' || data.exp < Date.now() / 1000) return null;
    return data as T;
  } catch {
    return null;
  }
}
