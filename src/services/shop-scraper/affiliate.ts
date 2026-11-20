import type { AffiliateSettings } from './types.js';

/**
 * Detecta a loja e aplica os SEUS dados de afiliado a um link comum de produto.
 *
 * Regras por programa (BR):
 *  - Amazon Associados: parâmetro ?tag=SUA-TAG-20 (troca a tag se já houver outra).
 *  - Mercado Livre: parâmetros matt_tool/matt_word (os mesmos do gerador de links).
 *  - Shopee: links curtos (s.shopee.com.br) já são de afiliado; em links longos
 *    adicionamos utm_source=an_<ID> (+ utm_content=<subId>) como faz o portal.
 *  - AliExpress: só links do Portals (s.click/a.aliexpress) creditam; avisamos quando não for.
 *  - Magalu (Parceiro Magalu): convertemos magazineluiza.com.br → magazinevoce.com.br/magazine<loja>.
 * Links encurtados de afiliado (amzn.to, mercadolivre.com/sec, s.shopee…) são mantidos como estão.
 */

export type StoreKey =
  | 'amazon'
  | 'mercadolivre'
  | 'shopee'
  | 'aliexpress'
  | 'magalu'
  | 'kabum'
  | 'americanas'
  | 'casasbahia'
  | 'other';

const STORE_MATCHERS: { key: StoreKey; name: string; match: RegExp }[] = [
  { key: 'amazon', name: 'Amazon', match: /(^|\.)amazon\.[a-z.]+$|(^|\.)amzn\.(to|com)$|(^|\.)a\.co$/i },
  { key: 'mercadolivre', name: 'Mercado Livre', match: /(^|\.)mercadoli(vre|bre)\.[a-z.]+$|(^|\.)meli\.la$/i },
  { key: 'shopee', name: 'Shopee', match: /(^|\.)shopee\.[a-z.]+$|(^|\.)shope\.ee$/i },
  { key: 'aliexpress', name: 'AliExpress', match: /aliexpress\.[a-z.]+$/i },
  { key: 'magalu', name: 'Magalu', match: /(^|\.)magazineluiza\.com\.br$|(^|\.)magazinevoce\.com\.br$|(^|\.)magalu\.com(\.br)?$/i },
  { key: 'kabum', name: 'KaBuM!', match: /(^|\.)kabum\.com\.br$/i },
  { key: 'americanas', name: 'Americanas', match: /(^|\.)americanas\.com\.br$/i },
  { key: 'casasbahia', name: 'Casas Bahia', match: /(^|\.)casasbahia\.com\.br$/i },
];

export function detectStore(rawUrl: string): { key: StoreKey; name: string } {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const hit = STORE_MATCHERS.find(s => s.match.test(host));
    if (hit) return { key: hit.key, name: hit.name };
    const parts = host.replace(/^www\./, '').split('.');
    const base = parts.length > 2 && parts.at(-2)!.length <= 3 ? parts.at(-3)! : parts.at(-2) || parts[0];
    return { key: 'other', name: base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Loja parceira' };
  } catch {
    return { key: 'other', name: 'Loja parceira' };
  }
}

/** Links que já são de afiliado por natureza (encurtadores dos programas). */
export function isShortAffiliateLink(rawUrl: string) {
  try {
    const u = new URL(rawUrl);
    const h = u.hostname.toLowerCase();
    return (
      /^(amzn\.to|a\.co)$/.test(h) ||
      (h.endsWith('mercadolivre.com') && u.pathname.startsWith('/sec/')) ||
      h === 'meli.la' ||
      /^s\.shopee\.|^shope\.ee$/.test(h) ||
      /^(s\.click|a)\.aliexpress\./.test(h) ||
      h === 'divulgador.magalu.com'
    );
  } catch {
    return false;
  }
}

const TRACKING_JUNK = /^(utm_(?!source$|content$)|ref_?$|psc$|smid$|spIA$|sprefix$|crid$|qid$|sr$|pd_rd_|pf_rd_|content-id$|_encoding$)/i;

export function applyAffiliate(rawUrl: string, s: AffiliateSettings) {
  const applied: string[] = [];
  const notes: string[] = [];
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return { url: rawUrl, applied, notes: ['Link inválido.'], store: detectStore(rawUrl) };
  }
  const store = detectStore(u.toString());
  if (isShortAffiliateLink(u.toString()) || s.autoApply === false) {
    return { url: u.toString(), applied, notes, store };
  }

  if (store.key === 'amazon') {
    // Link limpo /dp/ASIN + sua tag.
    const asin = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i)?.[1];
    if (asin) {
      u = new URL(`https://${u.hostname}/dp/${asin.toUpperCase()}`);
      applied.push('Link da Amazon limpo (/dp/ASIN)');
    }
    if (s.amazonTag) {
      u.searchParams.set('tag', s.amazonTag);
      applied.push(`Tag Amazon: ${s.amazonTag}`);
    } else notes.push('Configure sua tag da Amazon Associados em Configurações › Afiliados.');
  } else if (store.key === 'mercadolivre') {
    if (s.mercadoLivreTool || s.mercadoLivreWord) {
      for (const k of [...u.searchParams.keys()]) if (TRACKING_JUNK.test(k)) u.searchParams.delete(k);
      if (s.mercadoLivreTool) u.searchParams.set('matt_tool', s.mercadoLivreTool);
      if (s.mercadoLivreWord) u.searchParams.set('matt_word', s.mercadoLivreWord);
      applied.push('Parâmetros de afiliado do Mercado Livre (matt_tool/matt_word)');
    } else notes.push('Use o link curto gerado no painel Mercado Livre Afiliados ou configure matt_tool/matt_word.');
  } else if (store.key === 'shopee') {
    if (s.shopeeAffiliateId) {
      const id = s.shopeeAffiliateId.startsWith('an_') ? s.shopeeAffiliateId : `an_${s.shopeeAffiliateId}`;
      u.searchParams.set('utm_source', id);
      u.searchParams.set('utm_medium', 'affiliates');
      if (s.shopeeSubId) u.searchParams.set('utm_content', s.shopeeSubId);
      applied.push(`ID de afiliado Shopee: ${id}`);
      notes.push('Dica: o link curto gerado no portal Shopee Afiliados é o mais garantido para comissão.');
    } else notes.push('Use o link curto do portal Shopee Afiliados (s.shopee.com.br) ou configure seu ID an_.');
  } else if (store.key === 'aliexpress') {
    // O AliExpress só credita links gerados no Portals (s.click.aliexpress.com):
    // não dá para montar com segurança a partir do link comum.
    notes.push('Gere o link no AliExpress Portals (s.click.aliexpress.com) e cole aqui para garantir a comissão.');
  } else if (store.key === 'magalu') {
    if (s.magaluStore && u.hostname.endsWith('magazineluiza.com.br')) {
      u = new URL(`https://www.magazinevoce.com.br/magazine${s.magaluStore}${u.pathname}`);
      applied.push(`Loja Parceiro Magalu: magazine${s.magaluStore}`);
    } else if (!s.magaluStore) notes.push('Configure o nome da sua loja do Parceiro Magalu.');
  } else if (['kabum', 'americanas', 'casasbahia'].includes(store.key)) {
    notes.push(
      `${store.name} paga comissão por redes (Awin/Lomadee). Gere o link no painel da rede e cole aqui.`,
    );
  }
  return { url: u.toString(), applied, notes, store };
}
