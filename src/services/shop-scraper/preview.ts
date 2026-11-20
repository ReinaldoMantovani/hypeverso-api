import { applyAffiliate, detectStore } from './affiliate.js';
import { extractProductData, findProductLink, parsePriceToCents, productIds, upscaleImageUrl, type ProductData } from './extract.js';
import { BROWSER_HEADERS, fetchFollowing, FetchProblem } from './fetcher.js';
import type { AffiliateSettings } from './types.js';

export type ShopPreview = ProductData & {
  inputUrl: string;
  affiliateUrl: string;
  finalUrl: string;
  applied: string[];
  notes: string[];
  warnings: string[];
};

async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { ...BROWSER_HEADERS, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** API pública de itens do Mercado Livre: fotos em alta, título e preço. */
async function enrichMercadoLivre(data: ProductData, itemId: string) {
  const item = await json<any>(`https://api.mercadolibre.com/items/${itemId}`);
  if (!item || item.error) return false;
  const pics: string[] = (item.pictures || []).map((p: any) => p.secure_url || p.url).filter(Boolean);
  data.images = [...new Set([...pics.map(upscaleImageUrl), ...data.images])].slice(0, 12);
  data.title ||= item.title || null;
  data.priceCents ||= parsePriceToCents(item.price);
  if (!data.originalPriceCents && item.original_price && item.original_price > (item.price || 0))
    data.originalPriceCents = parsePriceToCents(item.original_price);
  for (const a of item.attributes || []) {
    if (a?.name && a?.value_name && data.specs.length < 25 && !data.specs.some(s => s.label === a.name))
      data.specs.push({ label: String(a.name), value: String(a.value_name) });
    if (!data.brand && /^(marca|brand)$/i.test(a?.name || '')) data.brand = a.value_name;
  }
  if (item.status) data.available = item.status === 'active' && (item.available_quantity ?? 1) > 0;
  return true;
}

/** API da página de produto da Shopee (a página em si é montada por JavaScript). */
async function enrichShopee(data: ProductData, ids: { shopId: string; itemId: string }, referer: string) {
  const r = await json<any>(`https://shopee.com.br/api/v4/item/get?itemid=${ids.itemId}&shopid=${ids.shopId}`, {
    Referer: referer,
    'X-Requested-With': 'XMLHttpRequest',
    'X-API-SOURCE': 'pc',
  });
  const item = r?.data || r?.item;
  if (!item) return false;
  const hashes: string[] = item.images || (item.image ? [item.image] : []);
  data.images = [...new Set([...hashes.map(h => `https://down-br.img.susercontent.com/file/${h}`), ...data.images])].slice(0, 12);
  data.title ||= item.name || null;
  // Preços da Shopee vêm multiplicados por 100000.
  if (!data.priceCents && item.price) data.priceCents = Math.round(Number(item.price) / 1000);
  if (!data.originalPriceCents && item.price_before_discount && item.price_before_discount > item.price)
    data.originalPriceCents = Math.round(Number(item.price_before_discount) / 1000);
  data.description ||= item.description ? String(item.description).slice(0, 1500) : null;
  if (typeof item.stock === 'number') data.available = item.stock > 0;
  return true;
}

export async function previewProduct(inputUrl: string, affiliate: AffiliateSettings): Promise<ShopPreview> {
  const aff = applyAffiliate(inputUrl, affiliate);
  const warnings: string[] = [];
  let page = await fetchFollowing(inputUrl);
  let html = page.body.toString('utf8');

  if (page.status >= 400) {
    warnings.push(`A loja respondeu HTTP ${page.status}. Algumas lojas bloqueiam leitura automática; confira os campos.`);
  }
  if (!page.contentType.includes('html')) throw new FetchProblem('O link não abriu uma página de produto.');

  let data = extractProductData(html, page.finalUrl);
  // Vitrines (ex.: perfil social do Mercado Livre) → abre o primeiro produto.
  if (!data.priceCents || data.images.length === 0) {
    const productLink = findProductLink(html, page.finalUrl);
    if (productLink && productLink !== page.finalUrl) {
      try {
        const next = await fetchFollowing(productLink);
        const nextHtml = next.body.toString('utf8');
        const nextData = extractProductData(nextHtml, next.finalUrl);
        if (nextData.title) {
          page = next;
          html = nextHtml;
          data = nextData;
        }
      } catch {}
    }
  }

  const ids = productIds(page.finalUrl);
  if (data.storeKey === 'mercadolivre' && ids.mercadoLivreItem && (data.images.length < 2 || !data.priceCents))
    await enrichMercadoLivre(data, ids.mercadoLivreItem);
  if (data.storeKey === 'shopee' && ids.shopee && (data.images.length < 2 || !data.title))
    await enrichShopee(data, ids.shopee, page.finalUrl);

  if (/captcha|robot check|não é um robô|são um robô|unusual traffic/i.test(html.slice(0, 40_000)) && !data.priceCents)
    warnings.push('A loja pediu verificação anti-robô. Abra o link no navegador uma vez e tente de novo, ou preencha à mão.');
  if (!data.title) warnings.push('Não encontramos o nome do produto.');
  if (!data.images.length) warnings.push('Não encontramos fotos. Envie uma imagem do seu computador.');
  if (!data.priceCents) warnings.push('Preço não encontrado (opcional).');

  return {
    ...data,
    store: data.store || detectStore(page.finalUrl).name,
    inputUrl,
    affiliateUrl: aff.url,
    finalUrl: page.finalUrl,
    applied: aff.applied,
    notes: aff.notes,
    warnings,
  };
}
