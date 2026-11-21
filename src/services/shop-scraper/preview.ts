// CÓPIA de hypeverso-cms/lib/server/preview.ts (mantenha as duas iguais).
import { applyAffiliate, detectStore } from './affiliate.js';
import { extractProductData, findProductLink, parsePriceToCents, productIds, upscaleImageUrl, type ProductData } from './extract.js';
import { browserDisabled, renderPage, type RenderedPage } from './browser.js';
import { BROWSER_HEADERS, fetchFollowing, FetchProblem, LINK_PREVIEW_AGENTS } from './fetcher.js';
import type { AffiliateSettings } from './types.js';

export type ShopPreview = ProductData & {
  inputUrl: string;
  affiliateUrl: string;
  finalUrl: string;
  applied: string[];
  notes: string[];
  warnings: string[];
  /** Como a página foi lida: "direto" (rápido) ou "navegador" (Edge/Chrome do seu PC). */
  via: 'direto' | 'prévia' | 'navegador';
};

/** Títulos que são só o nome da loja (página de redirecionamento, login, anti-robô…). */
const GENERIC_TITLE =
  /^(mercado ?(livre|libre)( brasil)?|shopee( brasil)?|amazon(\.com)?(\.br)?|aliexpress|magalu|magazine luiza|kabum!?|americanas|casas bahia|loja|carregando\.*|redirecionando\.*|just a moment\.*|access denied|robot check|attention required.*|página não encontrada|page not found)$/i;

function goodTitle(t: string | null | undefined) {
  const v = (t || '').trim();
  return v.length > 3 && !GENERIC_TITLE.test(v) && !/^(mercado ?(livre|libre)|shopee|amazon)\s*[-|:]\s*$/i.test(v);
}

function isComplete(d: ProductData) {
  return goodTitle(d.title) && d.images.length > 0;
}

/** Junta duas leituras da mesma página, ficando com o melhor de cada campo. */
function merge(a: ProductData, b: ProductData): ProductData {
  const pick = <T,>(x: T, y: T) => (x === null || x === undefined || x === '' ? y : x);
  return {
    ...a,
    title: goodTitle(a.title) ? a.title : goodTitle(b.title) ? b.title : a.title || b.title,
    description: (a.description?.length || 0) >= (b.description?.length || 0) ? pick(a.description, b.description) : b.description,
    bullets: a.bullets.length >= b.bullets.length ? a.bullets : b.bullets,
    specs: a.specs.length >= b.specs.length ? a.specs : b.specs,
    brand: pick(a.brand, b.brand),
    priceCents: pick(a.priceCents, b.priceCents),
    originalPriceCents: pick(a.originalPriceCents, b.originalPriceCents),
    rating: pick(a.rating, b.rating),
    reviewCount: pick(a.reviewCount, b.reviewCount),
    images: [...new Set([...a.images, ...b.images])].slice(0, 12),
    available: pick(a.available, b.available),
    store: a.storeKey !== 'other' ? a.store : b.store,
    storeKey: a.storeKey !== 'other' ? a.storeKey : b.storeKey,
  };
}

/** Todos os IDs de anúncio do Mercado Livre que aparecem nos links e na página. */
function mercadoLivreIds(...texts: string[]) {
  const items: string[] = [];
  const catalog: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/\/p\/MLB-?(\d{6,})/gi)) catalog.push(`MLB${m[1]}`);
    for (const m of t.matchAll(/(?:item_id|itemId|"id")["']?\s*[:=]\s*["']MLB-?(\d{6,})/gi)) items.push(`MLB${m[1]}`);
    for (const m of t.matchAll(/MLB-?(\d{8,})/gi)) items.push(`MLB${m[1]}`);
  }
  const uniq = (l: string[]) => [...new Set(l)];
  return { items: uniq(items).slice(0, 6), catalog: uniq(catalog).slice(0, 3) };
}

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
  if (!goodTitle(data.title)) data.title = item.title || data.title;
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

/** Página de catálogo do Mercado Livre (/p/MLB…): fotos e nome do produto. */
async function enrichMercadoLivreCatalog(data: ProductData, productId: string) {
  const p = await json<any>(`https://api.mercadolibre.com/products/${productId}`);
  if (!p || p.error) return false;
  const pics: string[] = (p.pictures || []).map((x: any) => x.url || x.secure_url).filter(Boolean);
  data.images = [...new Set([...pics.map(upscaleImageUrl), ...data.images])].slice(0, 12);
  if (!goodTitle(data.title)) data.title = p.name || data.title;
  data.priceCents ||= parsePriceToCents(p.buy_box_winner?.price);
  for (const a of p.attributes || []) {
    if (a?.name && a?.value_name && data.specs.length < 25 && !data.specs.some(s => s.label === a.name))
      data.specs.push({ label: String(a.name), value: String(a.value_name) });
  }
  data.description ||= p.short_description?.content || null;
  return pics.length > 0 || Boolean(p.name);
}

function applyShopeeItem(data: ProductData, item: any) {
  if (!item || typeof item !== 'object') return false;
  const hashes: string[] = item.images || (item.image ? [item.image] : []);
  data.images = [...new Set([...hashes.map(h => `https://down-br.img.susercontent.com/file/${h}`), ...data.images])].slice(0, 12);
  if (!goodTitle(data.title)) data.title = item.name || data.title;
  // Preços da Shopee vêm multiplicados por 100000.
  if (!data.priceCents && item.price) data.priceCents = Math.round(Number(item.price) / 1000);
  if (!data.originalPriceCents && item.price_before_discount && item.price_before_discount > item.price)
    data.originalPriceCents = Math.round(Number(item.price_before_discount) / 1000);
  data.description ||= item.description ? String(item.description).slice(0, 1500) : null;
  if (typeof item.stock === 'number') data.available = item.stock > 0;
  return true;
}

/** API da página de produto da Shopee (a página em si é montada por JavaScript). */
async function enrichShopee(data: ProductData, ids: { shopId: string; itemId: string }, referer: string) {
  const r = await json<any>(`https://shopee.com.br/api/v4/item/get?itemid=${ids.itemId}&shopid=${ids.shopId}`, {
    Referer: referer,
    'X-Requested-With': 'XMLHttpRequest',
    'X-API-SOURCE': 'pc',
  });
  return applyShopeeItem(data, r?.data || r?.item);
}

/** Respostas JSON que o navegador recebeu da Shopee (pdp/get_pc, item/get…). */
function shopeeFromNetwork(data: ProductData, bodies: string[]) {
  for (const b of bodies) {
    try {
      const j = JSON.parse(b);
      const item = j?.data?.item || j?.data?.product_info || j?.data || j?.item;
      if (item && (item.images || item.name || item.title) && applyShopeeItem(data, { ...item, name: item.name || item.title })) return true;
    } catch {}
  }
  return false;
}

async function readWithBrowser(url: string): Promise<{ page: RenderedPage; data: ProductData } | null> {
  const page = await renderPage(url);
  const data = extractProductData(page.html, page.finalUrl);
  // Vitrine (perfil social / lista do Mercado Livre) → abre o produto.
  if (!isComplete(data)) {
    const link = findProductLink(page.html, page.finalUrl);
    if (link && link !== page.finalUrl) {
      const inner = await renderPage(link).catch(() => null);
      if (inner) {
        const innerData = extractProductData(inner.html, inner.finalUrl);
        if (goodTitle(innerData.title) || innerData.images.length) {
          inner.hops = [...page.hops, ...inner.hops];
          inner.imageUrls = [...inner.imageUrls, ...page.imageUrls];
          inner.jsonBodies = [...inner.jsonBodies, ...page.jsonBodies];
          return { page: inner, data: innerData };
        }
      }
    }
  }
  return { page, data };
}

export async function previewProduct(inputUrl: string, affiliate: AffiliateSettings): Promise<ShopPreview> {
  const aff = applyAffiliate(inputUrl, affiliate);
  const inputStore = detectStore(inputUrl);
  const warnings: string[] = [];
  let via: ShopPreview['via'] = 'direto';
  let finalUrl = inputUrl;
  let hops: string[] = [inputUrl];
  let html = '';
  let data: ProductData | null = null;
  let staticError: string | null = null;

  // 1) Leitura rápida (sem navegador).
  try {
    let page = await fetchFollowing(inputUrl);
    if (page.status >= 400) warnings.push(`A loja respondeu HTTP ${page.status} na leitura rápida.`);
    if (page.contentType.includes('html')) {
      html = page.body.toString('utf8');
      data = extractProductData(html, page.finalUrl);
      if (!isComplete(data)) {
        const productLink = findProductLink(html, page.finalUrl);
        if (productLink && productLink !== page.finalUrl) {
          try {
            const next = await fetchFollowing(productLink);
            const nextHtml = next.body.toString('utf8');
            const nextData = extractProductData(nextHtml, next.finalUrl);
            if (goodTitle(nextData.title) || nextData.images.length) {
              page = { ...next, hops: [...page.hops, ...next.hops] };
              html = nextHtml;
              data = nextData;
            }
          } catch {}
        }
      }
    }
    finalUrl = page.finalUrl;
    hops = page.hops;
  } catch (error) {
    staticError = error instanceof Error ? error.message : String(error);
  }

  // 1b) Prévia de link (como o WhatsApp faz). É a forma mais confiável para a Shopee
  //     e também ajuda quando a loja bloqueia a leitura normal.
  if (!data || !isComplete(data)) {
    const targets = [inputUrl];
    const ids = productIds(finalUrl);
    if (ids.shopee) targets.push(`https://shopee.com.br/product/${ids.shopee.shopId}/${ids.shopee.itemId}`);
    outer: for (const target of [...new Set(targets)]) {
      for (const agent of LINK_PREVIEW_AGENTS) {
        try {
          const page = await fetchFollowing(target, { userAgent: agent, accept: 'text/html,*/*;q=0.8' });
          if (!page.contentType.includes('html')) continue;
          const bodyHtml = page.body.toString('utf8');
          const social = extractProductData(bodyHtml, page.finalUrl);
          if (goodTitle(social.title) || social.images.length) {
            data = data ? merge(data, social) : social;
            hops = [...new Set([...hops, ...page.hops])];
            if (!html) html = bodyHtml;
            if (finalUrl === inputUrl) finalUrl = page.finalUrl;
            via = via === 'direto' ? 'prévia' : via;
            if (isComplete(data)) break outer;
          }
        } catch {
          // tenta o próximo agente
        }
      }
    }
  }

  // 2) Página montada por JavaScript / redirecionamento por script → navegador do seu PC.
  let network: RenderedPage | null = null;
  if ((!data || !isComplete(data)) && !browserDisabled()) {
    try {
      const r = await readWithBrowser(inputUrl);
      if (r) {
        network = r.page;
        via = 'navegador';
        data = data ? merge(r.data, data) : r.data;
        finalUrl = r.page.finalUrl;
        hops = [...new Set([...hops, ...r.page.hops])];
        html = r.page.html;
      }
    } catch (error) {
      warnings.push(
        `Não consegui abrir o navegador para ler a página (${error instanceof Error ? error.message : 'erro'}). ` +
          'Instale o Microsoft Edge ou o Google Chrome, ou defina SHOP_BROWSER_PATH no .env.local.',
      );
    }
  }

  if (!data) {
    if (staticError) throw new FetchProblem(staticError);
    throw new FetchProblem('O link não abriu uma página de produto.');
  }

  // Loja: o link que você colou manda (meli.la → Mercado Livre, s.shopee → Shopee…).
  if (data.storeKey === 'other' && inputStore.key !== 'other') {
    data.store = inputStore.name;
    data.storeKey = inputStore.key;
  }

  // 3) APIs públicas das lojas para completar fotos/preço/ficha.
  if (data.storeKey === 'mercadolivre' && (!isComplete(data) || data.images.length < 3 || !data.priceCents)) {
    const ids = mercadoLivreIds(...hops, finalUrl, html.slice(0, 2_000_000));
    for (const id of ids.items) if (await enrichMercadoLivre(data, id)) break;
    if (!isComplete(data)) for (const id of ids.catalog) if (await enrichMercadoLivreCatalog(data, id)) break;
  }
  if (data.storeKey === 'shopee' && (!isComplete(data) || !data.priceCents)) {
    if (network) shopeeFromNetwork(data, network.jsonBodies);
    const ids = productIds(finalUrl);
    if (ids.shopee && (!isComplete(data) || !data.priceCents)) await enrichShopee(data, ids.shopee, finalUrl);
  }
  // Fotos que o navegador baixou da CDN da loja (último recurso).
  if (network && data.images.length < 2) {
    const extra = network.imageUrls.filter(u => !/(logo|sprite|icon|avatar|banner|badge|placeholder)/i.test(u)).map(upscaleImageUrl);
    data.images = [...new Set([...data.images, ...extra])].slice(0, 12);
  }

  if (!goodTitle(data.title)) data.title = null;
  if (/captcha|robot check|não é um robô|são um robô|unusual traffic|verifique que você é humano/i.test(html.slice(0, 60_000)) && !isComplete(data))
    warnings.push('A loja pediu verificação anti-robô. Abra o link no seu navegador uma vez, resolva a verificação e tente de novo.');
  if (!data.title) warnings.push('Não encontramos o nome do produto.');
  if (!data.images.length) warnings.push('Não encontramos fotos. Envie uma imagem do seu computador.');
  if (!data.priceCents) warnings.push('Preço não encontrado (opcional).');
  if (!isComplete(data)) warnings.push(`Página que o link abriu: ${finalUrl}`);

  return {
    ...data,
    store: data.store || inputStore.name,
    inputUrl,
    affiliateUrl: aff.url,
    finalUrl,
    applied: aff.applied,
    notes: aff.notes,
    warnings,
    via,
  };
}
