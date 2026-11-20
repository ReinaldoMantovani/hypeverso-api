/**
 * Shop de afiliados (lado da API). A leitura da página da loja, a escolha da
 * imagem e a geração de textos com IA acontecem no CMS, no seu PC: lá o IP é
 * residencial (as lojas bloqueiam menos) e o Ollama está disponível.
 */
const STORES: { match: RegExp; name: string }[] = [
  { match: /(^|\.)amazon\.[a-z.]+$|(^|\.)amzn\.(to|com)$|(^|\.)a\.co$/i, name: 'Amazon' },
  { match: /(^|\.)mercadoli(vre|bre)\.[a-z.]+$|(^|\.)meli\.la$/i, name: 'Mercado Livre' },
  { match: /(^|\.)shopee\.[a-z.]+$|(^|\.)shope\.ee$/i, name: 'Shopee' },
  { match: /aliexpress\.[a-z.]+$/i, name: 'AliExpress' },
  { match: /(^|\.)magazineluiza\.com\.br$|(^|\.)magazinevoce\.com\.br$|(^|\.)magalu\.com(\.br)?$/i, name: 'Magalu' },
  { match: /(^|\.)kabum\.com\.br$/i, name: 'KaBuM!' },
  { match: /(^|\.)americanas\.com\.br$/i, name: 'Americanas' },
  { match: /(^|\.)casasbahia\.com\.br$/i, name: 'Casas Bahia' },
  { match: /(^|\.)submarino\.com\.br$/i, name: 'Submarino' },
  { match: /(^|\.)netshoes\.com\.br$/i, name: 'Netshoes' },
  { match: /(^|\.)nuuvem\.com$/i, name: 'Nuuvem' },
  { match: /(^|\.)panini\.com\.br$/i, name: 'Panini' },
  { match: /(^|\.)piticas\.com\.br$/i, name: 'Piticas' },
  { match: /(^|\.)hotmart\.com$/i, name: 'Hotmart' },
];

export function detectStore(rawUrl: string) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const known = STORES.find(s => s.match.test(host));
    if (known) return known.name;
    const parts = host.replace(/^www\./, '').split('.');
    const base = parts.length > 2 && parts.at(-2)!.length <= 3 ? parts.at(-3)! : parts.at(-2) || parts[0];
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Loja parceira';
  } catch {
    return 'Loja parceira';
  }
}

/** Só aceitamos links http(s) públicos (sem credenciais, sem localhost). */
export function isAcceptableAffiliateUrl(raw: string) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    return !(host === 'localhost' || host.endsWith('.local') || /^(127\.|10\.|192\.168\.|0\.)/.test(host));
  } catch {
    return false;
  }
}
