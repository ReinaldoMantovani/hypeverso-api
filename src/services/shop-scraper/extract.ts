import * as cheerio from 'cheerio';
import { detectStore, type StoreKey } from './affiliate.js';

/**
 * Lê os dados do produto de uma página de loja. Combina, em ordem de confiança:
 * JSON-LD (schema.org/Product), Open Graph/Twitter, seletores específicos de
 * Amazon, Mercado Livre e Shopee, e por fim as maiores <img> da página.
 *
 * Imagens: cada loja usa um formato de URL e de arquivo diferente:
 *  - Amazon:  m.media-amazon.com/images/I/<id>._AC_SX679_.jpg  → tiramos o "._AC_…_" para pegar a original;
 *  - Mercado Livre: http2.mlstatic.com/D_NQ_NP_<id>-O.webp (WebP; -O = original, -I/-V = miniaturas);
 *  - Shopee: down-br.img.susercontent.com/file/<hash>(_tn) — sem extensão (JPEG ou WebP).
 * A conversão para WebP padronizado acontece depois, em image.ts (aceita JPG, PNG,
 * WebP, AVIF, GIF, TIFF, SVG…).
 */

export type ProductData = {
  title: string | null;
  description: string | null;
  bullets: string[];
  specs: { label: string; value: string }[];
  brand: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  currency: string;
  rating: number | null;
  reviewCount: number | null;
  images: string[];
  store: string;
  storeKey: StoreKey;
  /** true = em estoque, false = esgotado/indisponível, null = não deu para saber. */
  available: boolean | null;
};

const OUT_OF_STOCK_TEXT =
  /(fora de estoque|sem estoque|esgotad[oa]|indispon[ií]vel|não disponível|nao disponivel|publicação pausada|publicacao pausada|anúncio pausado|currently unavailable|out of stock|temporariamente sem estoque|produto não encontrado)/i;
const IN_STOCK_TEXT = /(em estoque|disponível|disponivel|in stock|comprar agora|adicionar ao carrinho)/i;

/** Lê a disponibilidade: JSON-LD (schema.org), meta tags e textos das lojas. */
export function detectAvailability($: cheerio.CheerioAPI, offers: any, storeKey: StoreKey): boolean | null {
  const ld = String(offers?.availability || '').toLowerCase();
  if (/outofstock|discontinued|soldout|preorder-closed/.test(ld)) return false;
  if (/instock|limitedavailability|onlineonly|preorder/.test(ld)) return true;
  const meta = (
    $('meta[property="product:availability"]').attr('content') ||
    $('meta[property="og:availability"]').attr('content') ||
    $('[itemprop="availability"]').attr('content') ||
    $('[itemprop="availability"]').attr('href') ||
    ''
  ).toLowerCase();
  if (/out of stock|outofstock|oos/.test(meta)) return false;
  if (/in stock|instock/.test(meta)) return true;
  const zones: string[] = [];
  if (storeKey === 'amazon') zones.push($('#availability').text(), $('#outOfStock').text());
  if (storeKey === 'mercadolivre')
    zones.push($('.ui-pdp-stock-information').text(), $('.ui-pdp-message').text(), $('.ui-pdp-container__row--stock-information').text());
  const zoneText = zones.join(' ').replace(/\s+/g, ' ');
  if (zoneText && OUT_OF_STOCK_TEXT.test(zoneText)) return false;
  if (zoneText && IN_STOCK_TEXT.test(zoneText)) return true;
  if (storeKey === 'amazon' && $('#add-to-cart-button, #buy-now-button').length) return true;
  if (storeKey === 'mercadolivre' && $('form.ui-pdp-actions__form, .ui-pdp-actions button').length) return true;
  return null;
}

export function parsePriceToCents(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  let s = String(value)
    .replace(/\s|&nbsp;/g, '')
    .replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma !== -1) s = s.replace(/,/g, '');
  else if (lastComma === -1 && lastDot !== -1 && s.length - lastDot - 1 === 3) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n * 100) : null;
}

const clean = (v?: string | null, max = 400) => {
  const t = (v || '')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return t ? t.slice(0, max) : null;
};

function absolute(url: string | null | undefined, base: string) {
  if (!url) return null;
  const raw = url.trim().replace(/&amp;/g, '&').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  if (raw.startsWith('data:image/')) return raw.length < 2_000_000 ? raw : null;
  try {
    const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw, base);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Versão em alta resolução de URLs conhecidas de CDN de lojas. */
export function upscaleImageUrl(url: string) {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (/media-amazon\.com$|images-amazon\.com$|ssl-images-amazon\.com$/.test(h)) {
      // ".../I/61abc._AC_SX679_.jpg" → ".../I/61abc.jpg"
      u.pathname = u.pathname.replace(/\._[^/]*?_\.(jpg|jpeg|png|webp|gif)$/i, '.$1');
      return u.toString();
    }
    if (/mlstatic\.com$/.test(h)) {
      // Miniaturas "-I", "-V", "-W", "-R", "-E" → original "-O".
      u.pathname = u.pathname.replace(/-[A-Z]\.(webp|jpg|jpeg|png)$/i, '-O.$1').replace('/D_Q_NP_', '/D_NQ_NP_');
      return u.toString();
    }
    if (/susercontent\.com$|img\.shopee\./.test(h)) {
      u.pathname = u.pathname.replace(/_tn$/, '');
      return u.toString();
    }
  } catch {}
  return url;
}

const JUNK_IMAGE =
  /(logo|sprite|icon|favicon|avatar|placeholder|loading|spinner|pixel|1x1|blank|badge|banner|rating|stars?[-_.]|flag|payment|seal|selo|transparent)/i;

function jsonLdProducts($: cheerio.CheerioAPI) {
  const out: any[] = [];
  const visit = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const t = n['@type'];
    if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) out.push(n);
    if (n['@graph']) visit(n['@graph']);
    if (n.mainEntity) visit(n.mainEntity);
  };
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      visit(JSON.parse($(el).contents().text()));
    } catch {}
  });
  return out;
}

class ImagePool {
  private scores = new Map<string, number>();
  constructor(private base: string) {}
  add(url: string | null | undefined, score: number) {
    const abs = absolute(url, this.base);
    if (!abs || (!abs.startsWith('data:') && JUNK_IMAGE.test(abs.split('?')[0]))) return;
    if (/\.svg(\?|$)/i.test(abs) && score < 5) return; // SVG quase sempre é ícone/logo
    const hi = upscaleImageUrl(abs);
    for (const [u, s] of [
      [hi, score + (hi !== abs ? 0.5 : 0)],
      [abs, score],
    ] as const) {
      this.scores.set(u, Math.max(this.scores.get(u) ?? 0, s));
    }
  }
  list(limit = 12) {
    // Remove duplicatas da mesma foto em tamanhos diferentes (fica a de maior pontuação).
    const seen = new Set<string>();
    return [...this.scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([u]) => u)
      .filter(u => {
        const key = u
          .replace(/\._[^/]*?_\./, '.')
          .replace(/-[A-Z]\.(webp|jpg|jpeg|png)$/i, '')
          .replace(/_tn$/, '')
          .replace(/\?.*$/, '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }
}

function srcsetLargest(srcset?: string) {
  if (!srcset) return null;
  const parts = srcset
    .split(',')
    .map(p => p.trim().split(/\s+/))
    .map(([u, d]) => ({ u, w: parseFloat(d || '1') || 1 }));
  parts.sort((a, b) => b.w - a.w);
  return parts[0]?.u || null;
}

export function extractProductData(html: string, finalUrl: string): ProductData {
  const $ = cheerio.load(html);
  const store = detectStore(finalUrl);
  const meta = (...names: string[]) => {
    for (const n of names) {
      const v =
        $(`meta[property="${n}"]`).attr('content') ||
        $(`meta[name="${n}"]`).attr('content') ||
        $(`meta[itemprop="${n}"]`).attr('content');
      if (v && v.trim()) return v.trim();
    }
    return null;
  };
  const scripts = $('script')
    .map((_i, el) => $(el).contents().text())
    .get()
    .join('\n');
  const product = jsonLdProducts($)[0];
  const offers = product ? (Array.isArray(product.offers) ? product.offers[0] : product.offers) : null;

  // ---------------- imagens
  const pool = new ImagePool(finalUrl);
  const ldImages = product ? (Array.isArray(product.image) ? product.image : [product.image]) : [];
  for (const im of ldImages) pool.add(typeof im === 'string' ? im : im?.url || im?.contentUrl, 7);
  pool.add(meta('og:image:secure_url', 'og:image'), 6);
  pool.add(meta('twitter:image', 'twitter:image:src'), 5);
  pool.add($('link[rel="image_src"]').attr('href'), 5);
  pool.add($('[itemprop="image"]').attr('content') || $('[itemprop="image"]').attr('src'), 5);

  if (store.key === 'amazon') {
    const main = $('#landingImage, #imgBlkFront, #ebooksImgBlkFront, #main-image').first();
    pool.add(main.attr('data-old-hires'), 9);
    const dyn = main.attr('data-a-dynamic-image');
    if (dyn) {
      try {
        const entries = Object.entries(JSON.parse(dyn) as Record<string, [number, number]>);
        entries.sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1]);
        entries.slice(0, 2).forEach(([u], i) => pool.add(u, 8.5 - i));
      } catch {}
    }
    for (const m of scripts.matchAll(/"hiRes"\s*:\s*"(https:[^"]+)"/g)) pool.add(m[1], 8);
    for (const m of scripts.matchAll(/"large"\s*:\s*"(https:[^"]+)"/g)) pool.add(m[1], 7);
  }
  if (store.key === 'mercadolivre') {
    $('figure.ui-pdp-gallery__figure img, .ui-pdp-gallery img, img.ui-pdp-image').each((i, el) => {
      const img = $(el);
      pool.add(img.attr('data-zoom') || img.attr('data-src') || img.attr('src'), 9 - Math.min(i, 6) * 0.2);
    });
    for (const m of html.matchAll(/https?:\\?\/\\?\/http2\.mlstatic\.com\\?\/D_[A-Za-z0-9_]+?-[A-Z]\.(?:webp|jpg|jpeg|png)/g))
      pool.add(m[0].replace(/\\\//g, '/'), 6.5);
  }
  if (store.key === 'shopee') {
    for (const m of scripts.matchAll(/"images?"\s*:\s*\[([^\]]{10,4000})\]/g)) {
      for (const h of m[1].matchAll(/"([0-9a-z-]{20,64})"/g)) pool.add(`https://down-br.img.susercontent.com/file/${h[1]}`, 7.5);
    }
    for (const m of html.matchAll(/https?:\/\/down-[a-z]+\.img\.susercontent\.com\/file\/[0-9a-z_-]+/g)) pool.add(m[0], 6.5);
  }
  // Genérico: imagens grandes da página.
  $('img').each((_i, el) => {
    const img = $(el);
    const w = Number(img.attr('width') || 0);
    const h = Number(img.attr('height') || 0);
    if ((w && w < 200) || (h && h < 200)) return;
    const src =
      srcsetLargest(img.attr('srcset') || img.attr('data-srcset')) ||
      img.attr('data-zoom-image') ||
      img.attr('data-large') ||
      img.attr('data-src') ||
      img.attr('data-lazy') ||
      img.attr('src');
    pool.add(src, w >= 500 || h >= 500 ? 3 : 1.5);
  });

  // ---------------- textos
  const title =
    clean($('#productTitle').text(), 220) ||
    clean($('h1.ui-pdp-title').text(), 220) ||
    clean(product?.name, 220) ||
    clean(meta('og:title', 'twitter:title'), 220) ||
    clean($('h1').first().text(), 220) ||
    clean($('title').text(), 220);

  const bullets: string[] = [];
  const pushBullet = (t?: string | null) => {
    const c = clean(t, 300);
    if (c && c.length > 8 && !bullets.includes(c) && bullets.length < 12) bullets.push(c);
  };
  $('#feature-bullets li span.a-list-item, #feature-bullets li').each((_i, el) => pushBullet($(el).text()));
  $('.ui-pdp-features li, .ui-vpp-highlighted-specs__features-list li').each((_i, el) => pushBullet($(el).text()));
  if (!bullets.length) $('[class*="highlight"] li, [class*="feature"] li').slice(0, 8).each((_i, el) => pushBullet($(el).text()));

  const specs: { label: string; value: string }[] = [];
  const pushSpec = (label?: string | null, value?: string | null) => {
    const l = clean(label, 60)?.replace(/[:‎‏]/g, '').trim();
    const v = clean(value, 160)?.replace(/[‎‏]/g, '').trim();
    if (l && v && specs.length < 25 && !specs.some(s => s.label === l)) specs.push({ label: l, value: v });
  };
  $('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, #productOverview_feature_div tr').each(
    (_i, el) => pushSpec($(el).find('th, td').first().text(), $(el).find('td').last().text()),
  );
  $('#detailBullets_feature_div li').each((_i, el) => {
    const t = $(el).text().split(':');
    if (t.length >= 2) pushSpec(t[0], t.slice(1).join(':'));
  });
  $('.andes-table tr, .ui-vpp-striped-specs__table tr').each((_i, el) =>
    pushSpec($(el).find('th').first().text(), $(el).find('td').first().text()),
  );

  const description =
    clean(product?.description, 1500) ||
    clean($('#productDescription').text(), 1500) ||
    clean($('.ui-pdp-description__content').text(), 1500) ||
    clean(meta('og:description', 'description', 'twitter:description'), 1500);

  const brand =
    clean(typeof product?.brand === 'string' ? product.brand : product?.brand?.name, 80) ||
    clean($('#bylineInfo').text().replace(/^(Marca|Visite a loja)\s*:?\s*/i, ''), 80) ||
    specs.find(s => /^marca$|^brand$/i.test(s.label))?.value ||
    null;

  const priceCents =
    parsePriceToCents($('#corePrice_feature_div .a-price .a-offscreen').first().text()) ||
    parsePriceToCents($('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen').first().text()) ||
    parsePriceToCents($('.a-price.priceToPay .a-offscreen').first().text()) ||
    parsePriceToCents(offers?.price ?? offers?.lowPrice) ||
    parsePriceToCents(meta('product:price:amount', 'og:price:amount', 'price')) ||
    parsePriceToCents(
      $('.ui-pdp-price__second-line .andes-money-amount__fraction').first().text() +
        ($('.ui-pdp-price__second-line .andes-money-amount__cents').first().text()
          ? ',' + $('.ui-pdp-price__second-line .andes-money-amount__cents').first().text()
          : ''),
    );
  const originalPriceCents =
    parsePriceToCents($('.a-price.a-text-price .a-offscreen').first().text()) ||
    parsePriceToCents($('s.andes-money-amount--previous .andes-money-amount__fraction').first().text()) ||
    parsePriceToCents(offers?.highPrice);

  const ratingRaw = product?.aggregateRating?.ratingValue ?? null;
  const reviewRaw = product?.aggregateRating?.reviewCount ?? product?.aggregateRating?.ratingCount ?? null;

  return {
    title,
    description,
    bullets,
    specs,
    brand,
    priceCents,
    originalPriceCents: originalPriceCents && priceCents && originalPriceCents > priceCents ? originalPriceCents : null,
    currency:
      String(offers?.priceCurrency || meta('product:price:currency', 'og:price:currency') || 'BRL')
        .toUpperCase()
        .slice(0, 3) || 'BRL',
    rating: ratingRaw !== null && Number.isFinite(Number(ratingRaw)) ? Number(ratingRaw) : null,
    reviewCount: reviewRaw !== null && Number.isFinite(Number(reviewRaw)) ? Number(reviewRaw) : null,
    images: pool.list(),
    store: store.name,
    storeKey: store.key,
    available: detectAvailability($, offers, store.key),
  };
}

/** Páginas "vitrine" (ex.: perfil social do Mercado Livre) → primeiro link de produto. */
export function findProductLink(html: string, finalUrl: string) {
  const store = detectStore(finalUrl).key;
  if (store === 'mercadolivre') {
    const m =
      html.match(/https:\/\/(?:produto|www)\.mercadolivre\.com\.br\/(?:[^"'\s<>]*?\/)?(?:MLB-?\d{6,}|p\/MLB\d{6,})[^"'\s<>]*/i) ||
      html.match(/https:\\\/\\\/(?:produto|www)\.mercadolivre\.com\.br\\\/[^"'\s<>]*?MLB-?\d{6,}[^"'\s<>]*/i);
    return m ? m[0].replace(/\\\//g, '/').replace(/&amp;/g, '&') : null;
  }
  return null;
}

/** IDs úteis para APIs públicas das lojas. */
export function productIds(url: string) {
  const ml = url.match(/MLB-?(\d{6,})/i);
  const shopee = url.match(/-i\.(\d+)\.(\d+)/) || url.match(/\/product\/(\d+)\/(\d+)/);
  return {
    mercadoLivreItem: ml ? `MLB${ml[1]}` : null,
    shopee: shopee ? { shopId: shopee[1], itemId: shopee[2] } : null,
  };
}
