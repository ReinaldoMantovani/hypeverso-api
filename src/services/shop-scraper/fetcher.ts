// CÓPIA de hypeverso-cms/lib/server/fetcher.ts (mantenha as duas iguais).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Busca páginas e imagens das lojas a partir do SEU PC (IP residencial: Amazon,
 * Mercado Livre e Shopee bloqueiam bem menos do que IPs de servidores).
 * Segue redirecionamentos de encurtadores (amzn.to, mercadolivre.com/sec,
 * s.shopee.com.br…), guarda cookies entre os saltos e nunca acessa endereços
 * da sua rede local (anti-SSRF).
 */

export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.6,en;q=0.5',
  'Cache-Control': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

/**
 * Agentes de "prévia de link". Lojas como a Shopee montam a página por JavaScript
 * e escondem os dados de robôs comuns, mas entregam título/foto/preço em meta tags
 * para o WhatsApp e o Facebook mostrarem a prévia do link. Usamos o mesmo caminho.
 */
export const LINK_PREVIEW_AGENTS = [
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'WhatsApp/2.24.20.80 A',
  'Twitterbot/1.0',
];

export class FetchProblem extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

const privateV4 = (h: string) => {
  const p = h.split('.').map(Number);
  return (
    p[0] === 10 ||
    p[0] === 127 ||
    p[0] === 0 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    p[0] >= 224
  );
};
const privateV6 = (h: string) => {
  const x = h.toLowerCase().replace(/^\[|\]$/g, '');
  if (x === '::' || x === '::1') return true;
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return /^(fe[89ab]|fc|fd|ff)/.test(x);
};

export async function assertPublicUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchProblem('Link inválido. Cole a URL completa (começando com https://).');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new FetchProblem('Use um link http(s).');
  if (u.username || u.password) throw new FetchProblem('Links com usuário/senha não são aceitos.');
  if (u.port && !['80', '443'].includes(u.port)) throw new FetchProblem('Porta não permitida.');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.'))
    throw new FetchProblem('Endereço local não é permitido.');
  const bad = (a: string, f: number) => (f === 4 ? privateV4(a) : privateV6(a));
  if (isIP(host)) {
    if (bad(host, isIP(host))) throw new FetchProblem('Endereço da rede local não é permitido.');
    return u;
  }
  const addrs = await lookup(host, { all: true }).catch(() => {
    throw new FetchProblem(`Não encontramos o site ${host}. Verifique o link.`);
  });
  if (!addrs.length || addrs.some(a => bad(a.address, a.family)))
    throw new FetchProblem('Endereço da rede local não é permitido.');
  return u;
}

async function readLimited(res: Response, max: number) {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new FetchProblem('Arquivo grande demais.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

type FetchResult = { finalUrl: string; status: number; contentType: string; body: Buffer; hops: string[] };

export async function fetchFollowing(
  rawUrl: string,
  opts: { accept?: string; referer?: string; maxBytes?: number; timeoutMs?: number; userAgent?: string } = {},
): Promise<FetchResult> {
  let current = (await assertPublicUrl(rawUrl)).toString();
  const jar = new Map<string, string>();
  const hops: string[] = [current];
  for (let hop = 0; hop <= 10; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
    let res: Response;
    try {
      const headers: Record<string, string> = { ...BROWSER_HEADERS };
      if (opts.accept) headers.Accept = opts.accept;
      if (opts.referer) headers.Referer = opts.referer;
      if (opts.userAgent) {
        // Leitores de "prévia de link" (WhatsApp/Facebook) não mandam cabeçalhos de navegador.
        headers['User-Agent'] = opts.userAgent;
        for (const k of Object.keys(headers)) if (k.startsWith('Sec-') || k === 'Upgrade-Insecure-Requests') delete headers[k];
      }
      if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      res = await fetch(current, { headers, redirect: 'manual', signal: controller.signal });
    } catch (error) {
      const timeout = error instanceof Error && error.name === 'AbortError';
      throw new FetchProblem(
        timeout ? 'A loja demorou demais para responder. Tente de novo.' : 'Não foi possível abrir o link.',
        504,
      );
    } finally {
      clearTimeout(timer);
    }
    const setCookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
    for (const c of setCookies) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      await res.arrayBuffer().catch(() => undefined);
      if (!location) throw new FetchProblem('Redirecionamento sem destino.');
      current = (await assertPublicUrl(new URL(location, current).toString())).toString();
      hops.push(current);
      continue;
    }
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const body = await readLimited(res, opts.maxBytes ?? 4 * 1024 * 1024);
    // Encurtadores que redirecionam por HTML/JS (meta refresh ou location.href).
    if (contentType.includes('html') && body.length < 60_000) {
      const html = body.toString('utf8');
      const next =
        html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?\s*\d+\s*;\s*url=([^"'>\s]+)/i)?.[1] ||
        html.match(/(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1] ||
        html.match(/location\.replace\(\s*["'](https?:\/\/[^"']+)["']\s*\)/i)?.[1];
      if (next && hop < 10 && !/og:title|application\/ld\+json/i.test(html)) {
        current = (await assertPublicUrl(new URL(next.replace(/&amp;/g, '&'), current).toString())).toString();
        hops.push(current);
        continue;
      }
    }
    return { finalUrl: current, status: res.status, contentType, body, hops };
  }
  throw new FetchProblem('Redirecionamentos demais no link.');
}
