import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import { env } from '../config/env.js';

export const GATEWAY_SECRET_HEADER = 'x-hv-gateway-secret';
export const GATEWAY_CLIENT_IP_HEADER = 'x-hv-client-ip';

function sameSecret(received: string, expected: string) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** O pedido veio do gateway do site/CMS (segredo compartilhado válido)? */
export function isTrustedGateway(request: FastifyRequest) {
  const expected = (env.GATEWAY_SHARED_SECRET || '').trim();
  if (expected.length < 16) return false;
  const received = request.headers[GATEWAY_SECRET_HEADER];
  return typeof received === 'string' && sameSecret(received, expected);
}

/**
 * IP real do visitante. Com o front na Hostinger e a API em outro servidor, todo
 * tráfego do site chega com o IP do servidor da Hostinger; sem isto o rate limit
 * seria compartilhado por todos os leitores. Só confiamos no cabeçalho quando o
 * gateway prova a identidade com GATEWAY_SHARED_SECRET.
 */
export function clientIp(request: FastifyRequest): string {
  if (isTrustedGateway(request)) {
    const raw = request.headers[GATEWAY_CLIENT_IP_HEADER];
    const value = (Array.isArray(raw) ? raw[0] : raw || '').split(',')[0].trim();
    if (value && isIP(value)) return value;
  }
  return request.ip;
}
