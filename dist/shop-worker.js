import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  applyCheckResult,
  productsDueForCheck
} from "./chunk-DVHMYG66.js";
import "./chunk-OG6KD6QD.js";
import "./chunk-ZIMWUEV2.js";
import {
  db_exports,
  prisma
} from "./chunk-AFZENULZ.js";

// src/shop-worker.ts
import { createServer } from "http";
import { setTimeout as sleep } from "timers/promises";

// src/services/shop-scraper/affiliate.ts
var STORE_MATCHERS = [
  { key: "amazon", name: "Amazon", match: /(^|\.)amazon\.[a-z.]+$|(^|\.)amzn\.(to|com)$|(^|\.)a\.co$/i },
  { key: "mercadolivre", name: "Mercado Livre", match: /(^|\.)mercadoli(vre|bre)\.[a-z.]+$|(^|\.)meli\.la$/i },
  { key: "shopee", name: "Shopee", match: /(^|\.)shopee\.[a-z.]+$|(^|\.)shope\.ee$/i },
  { key: "aliexpress", name: "AliExpress", match: /aliexpress\.[a-z.]+$/i },
  { key: "magalu", name: "Magalu", match: /(^|\.)magazineluiza\.com\.br$|(^|\.)magazinevoce\.com\.br$|(^|\.)magalu\.com(\.br)?$/i },
  { key: "kabum", name: "KaBuM!", match: /(^|\.)kabum\.com\.br$/i },
  { key: "americanas", name: "Americanas", match: /(^|\.)americanas\.com\.br$/i },
  { key: "casasbahia", name: "Casas Bahia", match: /(^|\.)casasbahia\.com\.br$/i }
];
function detectStore(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const hit = STORE_MATCHERS.find((s) => s.match.test(host));
    if (hit) return { key: hit.key, name: hit.name };
    const parts = host.replace(/^www\./, "").split(".");
    const base = parts.length > 2 && parts.at(-2).length <= 3 ? parts.at(-3) : parts.at(-2) || parts[0];
    return { key: "other", name: base ? base.charAt(0).toUpperCase() + base.slice(1) : "Loja parceira" };
  } catch {
    return { key: "other", name: "Loja parceira" };
  }
}
function isShortAffiliateLink(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const h = u.hostname.toLowerCase();
    return /^(amzn\.to|a\.co)$/.test(h) || h.endsWith("mercadolivre.com") && u.pathname.startsWith("/sec/") || h === "meli.la" || /^s\.shopee\.|^shope\.ee$/.test(h) || /^(s\.click|a)\.aliexpress\./.test(h) || h === "divulgador.magalu.com";
  } catch {
    return false;
  }
}
var TRACKING_JUNK = /^(utm_(?!source$|content$)|ref_?$|psc$|smid$|spIA$|sprefix$|crid$|qid$|sr$|pd_rd_|pf_rd_|content-id$|_encoding$)/i;
function applyAffiliate(rawUrl, s) {
  const applied = [];
  const notes = [];
  let u;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return { url: rawUrl, applied, notes: ["Link inv\xE1lido."], store: detectStore(rawUrl) };
  }
  const store = detectStore(u.toString());
  if (isShortAffiliateLink(u.toString()) || s.autoApply === false) {
    return { url: u.toString(), applied, notes, store };
  }
  if (store.key === "amazon") {
    const asin = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i)?.[1];
    if (asin) {
      u = new URL(`https://${u.hostname}/dp/${asin.toUpperCase()}`);
      applied.push("Link da Amazon limpo (/dp/ASIN)");
    }
    if (s.amazonTag) {
      u.searchParams.set("tag", s.amazonTag);
      applied.push(`Tag Amazon: ${s.amazonTag}`);
    } else notes.push("Configure sua tag da Amazon Associados em Configura\xE7\xF5es \u203A Afiliados.");
  } else if (store.key === "mercadolivre") {
    if (s.mercadoLivreTool || s.mercadoLivreWord) {
      for (const k of [...u.searchParams.keys()]) if (TRACKING_JUNK.test(k)) u.searchParams.delete(k);
      if (s.mercadoLivreTool) u.searchParams.set("matt_tool", s.mercadoLivreTool);
      if (s.mercadoLivreWord) u.searchParams.set("matt_word", s.mercadoLivreWord);
      applied.push("Par\xE2metros de afiliado do Mercado Livre (matt_tool/matt_word)");
    } else notes.push("Use o link curto gerado no painel Mercado Livre Afiliados ou configure matt_tool/matt_word.");
  } else if (store.key === "shopee") {
    if (s.shopeeAffiliateId) {
      const id = s.shopeeAffiliateId.startsWith("an_") ? s.shopeeAffiliateId : `an_${s.shopeeAffiliateId}`;
      u.searchParams.set("utm_source", id);
      u.searchParams.set("utm_medium", "affiliates");
      if (s.shopeeSubId) u.searchParams.set("utm_content", s.shopeeSubId);
      applied.push(`ID de afiliado Shopee: ${id}`);
      notes.push("Dica: o link curto gerado no portal Shopee Afiliados \xE9 o mais garantido para comiss\xE3o.");
    } else notes.push("Use o link curto do portal Shopee Afiliados (s.shopee.com.br) ou configure seu ID an_.");
  } else if (store.key === "aliexpress") {
    notes.push("Gere o link no AliExpress Portals (s.click.aliexpress.com) e cole aqui para garantir a comiss\xE3o.");
  } else if (store.key === "magalu") {
    if (s.magaluStore && u.hostname.endsWith("magazineluiza.com.br")) {
      u = new URL(`https://www.magazinevoce.com.br/magazine${s.magaluStore}${u.pathname}`);
      applied.push(`Loja Parceiro Magalu: magazine${s.magaluStore}`);
    } else if (!s.magaluStore) notes.push("Configure o nome da sua loja do Parceiro Magalu.");
  } else if (["kabum", "americanas", "casasbahia"].includes(store.key)) {
    notes.push(
      `${store.name} paga comiss\xE3o por redes (Awin/Lomadee). Gere o link no painel da rede e cole aqui.`
    );
  }
  return { url: u.toString(), applied, notes, store };
}

// src/services/shop-scraper/extract.ts
import * as cheerio from "cheerio";
var OUT_OF_STOCK_TEXT = /(fora de estoque|sem estoque|esgotad[oa]|indispon[ií]vel|não disponível|nao disponivel|publicação pausada|publicacao pausada|anúncio pausado|currently unavailable|out of stock|temporariamente sem estoque|produto não encontrado)/i;
var IN_STOCK_TEXT = /(em estoque|disponível|disponivel|in stock|comprar agora|adicionar ao carrinho)/i;
function detectAvailability($, offers, storeKey) {
  const ld = String(offers?.availability || "").toLowerCase();
  if (/outofstock|discontinued|soldout|preorder-closed/.test(ld)) return false;
  if (/instock|limitedavailability|onlineonly|preorder/.test(ld)) return true;
  const meta = ($('meta[property="product:availability"]').attr("content") || $('meta[property="og:availability"]').attr("content") || $('[itemprop="availability"]').attr("content") || $('[itemprop="availability"]').attr("href") || "").toLowerCase();
  if (/out of stock|outofstock|oos/.test(meta)) return false;
  if (/in stock|instock/.test(meta)) return true;
  const zones = [];
  if (storeKey === "amazon") zones.push($("#availability").text(), $("#outOfStock").text());
  if (storeKey === "mercadolivre")
    zones.push($(".ui-pdp-stock-information").text(), $(".ui-pdp-message").text(), $(".ui-pdp-container__row--stock-information").text());
  const zoneText = zones.join(" ").replace(/\s+/g, " ");
  if (zoneText && OUT_OF_STOCK_TEXT.test(zoneText)) return false;
  if (zoneText && IN_STOCK_TEXT.test(zoneText)) return true;
  if (storeKey === "amazon" && $("#add-to-cart-button, #buy-now-button").length) return true;
  if (storeKey === "mercadolivre" && $("form.ui-pdp-actions__form, .ui-pdp-actions button").length) return true;
  return null;
}
function parsePriceToCents(value) {
  if (value === null || value === void 0 || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  let s = String(value).replace(/\s|&nbsp;/g, "").replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma && lastComma !== -1) s = s.replace(/,/g, "");
  else if (lastComma === -1 && lastDot !== -1 && s.length - lastDot - 1 === 3) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 1e7 ? Math.round(n * 100) : null;
}
var clean = (v, max = 400) => {
  const t = (v || "").replace(/\s+/g, " ").replace(/&nbsp;/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
function absolute(url, base) {
  if (!url) return null;
  const raw = url.trim().replace(/&amp;/g, "&").replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  if (raw.startsWith("data:image/")) return raw.length < 2e6 ? raw : null;
  try {
    const u = new URL(raw.startsWith("//") ? `https:${raw}` : raw, base);
    return ["http:", "https:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}
function upscaleImageUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (/media-amazon\.com$|images-amazon\.com$|ssl-images-amazon\.com$/.test(h)) {
      u.pathname = u.pathname.replace(/\._[^/]*?_\.(jpg|jpeg|png|webp|gif)$/i, ".$1");
      return u.toString();
    }
    if (/mlstatic\.com$/.test(h)) {
      u.pathname = u.pathname.replace(/-[A-Z]\.(webp|jpg|jpeg|png)$/i, "-O.$1").replace("/D_Q_NP_", "/D_NQ_NP_");
      return u.toString();
    }
    if (/susercontent\.com$|img\.shopee\./.test(h)) {
      u.pathname = u.pathname.replace(/_tn$/, "");
      return u.toString();
    }
  } catch {
  }
  return url;
}
var JUNK_IMAGE = /(logo|sprite|icon|favicon|avatar|placeholder|loading|spinner|pixel|1x1|blank|badge|banner|rating|stars?[-_.]|flag|payment|seal|selo|transparent)/i;
function jsonLdProducts($) {
  const out = [];
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    const t = n["@type"];
    if (t === "Product" || Array.isArray(t) && t.includes("Product")) out.push(n);
    if (n["@graph"]) visit(n["@graph"]);
    if (n.mainEntity) visit(n.mainEntity);
  };
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      visit(JSON.parse($(el).contents().text()));
    } catch {
    }
  });
  return out;
}
var ImagePool = class {
  constructor(base) {
    this.base = base;
  }
  base;
  scores = /* @__PURE__ */ new Map();
  add(url, score) {
    const abs = absolute(url, this.base);
    if (!abs || !abs.startsWith("data:") && JUNK_IMAGE.test(abs.split("?")[0])) return;
    if (/\.svg(\?|$)/i.test(abs) && score < 5) return;
    const hi = upscaleImageUrl(abs);
    for (const [u, s] of [
      [hi, score + (hi !== abs ? 0.5 : 0)],
      [abs, score]
    ]) {
      this.scores.set(u, Math.max(this.scores.get(u) ?? 0, s));
    }
  }
  list(limit = 12) {
    const seen = /* @__PURE__ */ new Set();
    return [...this.scores.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u).filter((u) => {
      const key = u.replace(/\._[^/]*?_\./, ".").replace(/-[A-Z]\.(webp|jpg|jpeg|png)$/i, "").replace(/_tn$/, "").replace(/\?.*$/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
  }
};
function srcsetLargest(srcset) {
  if (!srcset) return null;
  const parts = srcset.split(",").map((p) => p.trim().split(/\s+/)).map(([u, d]) => ({ u, w: parseFloat(d || "1") || 1 }));
  parts.sort((a, b) => b.w - a.w);
  return parts[0]?.u || null;
}
function extractProductData(html, finalUrl) {
  const $ = cheerio.load(html);
  const store = detectStore(finalUrl);
  const meta = (...names) => {
    for (const n of names) {
      const v = $(`meta[property="${n}"]`).attr("content") || $(`meta[name="${n}"]`).attr("content") || $(`meta[itemprop="${n}"]`).attr("content");
      if (v && v.trim()) return v.trim();
    }
    return null;
  };
  const scripts = $("script").map((_i, el) => $(el).contents().text()).get().join("\n");
  const product = jsonLdProducts($)[0];
  const offers = product ? Array.isArray(product.offers) ? product.offers[0] : product.offers : null;
  const pool = new ImagePool(finalUrl);
  const ldImages = product ? Array.isArray(product.image) ? product.image : [product.image] : [];
  for (const im of ldImages) pool.add(typeof im === "string" ? im : im?.url || im?.contentUrl, 7);
  pool.add(meta("og:image:secure_url", "og:image"), 6);
  pool.add(meta("twitter:image", "twitter:image:src"), 5);
  pool.add($('link[rel="image_src"]').attr("href"), 5);
  pool.add($('[itemprop="image"]').attr("content") || $('[itemprop="image"]').attr("src"), 5);
  if (store.key === "amazon") {
    const main = $("#landingImage, #imgBlkFront, #ebooksImgBlkFront, #main-image").first();
    pool.add(main.attr("data-old-hires"), 9);
    const dyn = main.attr("data-a-dynamic-image");
    if (dyn) {
      try {
        const entries = Object.entries(JSON.parse(dyn));
        entries.sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1]);
        entries.slice(0, 2).forEach(([u], i) => pool.add(u, 8.5 - i));
      } catch {
      }
    }
    for (const m of scripts.matchAll(/"hiRes"\s*:\s*"(https:[^"]+)"/g)) pool.add(m[1], 8);
    for (const m of scripts.matchAll(/"large"\s*:\s*"(https:[^"]+)"/g)) pool.add(m[1], 7);
  }
  if (store.key === "mercadolivre") {
    $("figure.ui-pdp-gallery__figure img, .ui-pdp-gallery img, img.ui-pdp-image").each((i, el) => {
      const img = $(el);
      pool.add(img.attr("data-zoom") || img.attr("data-src") || img.attr("src"), 9 - Math.min(i, 6) * 0.2);
    });
    for (const m of html.matchAll(/https?:\\?\/\\?\/http2\.mlstatic\.com\\?\/D_[A-Za-z0-9_]+?-[A-Z]\.(?:webp|jpg|jpeg|png)/g))
      pool.add(m[0].replace(/\\\//g, "/"), 6.5);
  }
  if (store.key === "shopee") {
    for (const m of scripts.matchAll(/"images?"\s*:\s*\[([^\]]{10,4000})\]/g)) {
      for (const h of m[1].matchAll(/"([0-9a-z-]{20,64})"/g)) pool.add(`https://down-br.img.susercontent.com/file/${h[1]}`, 7.5);
    }
    for (const m of html.matchAll(/https?:\/\/down-[a-z]+\.img\.susercontent\.com\/file\/[0-9a-z_-]+/g)) pool.add(m[0], 6.5);
  }
  $("img").each((_i, el) => {
    const img = $(el);
    const w = Number(img.attr("width") || 0);
    const h = Number(img.attr("height") || 0);
    if (w && w < 200 || h && h < 200) return;
    const src = srcsetLargest(img.attr("srcset") || img.attr("data-srcset")) || img.attr("data-zoom-image") || img.attr("data-large") || img.attr("data-src") || img.attr("data-lazy") || img.attr("src");
    pool.add(src, w >= 500 || h >= 500 ? 3 : 1.5);
  });
  const title = clean($("#productTitle").text(), 220) || clean($("h1.ui-pdp-title").text(), 220) || clean(product?.name, 220) || clean(meta("og:title", "twitter:title"), 220) || clean($("h1").first().text(), 220) || clean($("title").text(), 220);
  const bullets = [];
  const pushBullet = (t) => {
    const c = clean(t, 300);
    if (c && c.length > 8 && !bullets.includes(c) && bullets.length < 12) bullets.push(c);
  };
  $("#feature-bullets li span.a-list-item, #feature-bullets li").each((_i, el) => pushBullet($(el).text()));
  $(".ui-pdp-features li, .ui-vpp-highlighted-specs__features-list li").each((_i, el) => pushBullet($(el).text()));
  if (!bullets.length) $('[class*="highlight"] li, [class*="feature"] li').slice(0, 8).each((_i, el) => pushBullet($(el).text()));
  const specs = [];
  const pushSpec = (label, value) => {
    const l = clean(label, 60)?.replace(/[:‎‏]/g, "").trim();
    const v = clean(value, 160)?.replace(/[‎‏]/g, "").trim();
    if (l && v && specs.length < 25 && !specs.some((s) => s.label === l)) specs.push({ label: l, value: v });
  };
  $("#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, #productOverview_feature_div tr").each(
    (_i, el) => pushSpec($(el).find("th, td").first().text(), $(el).find("td").last().text())
  );
  $("#detailBullets_feature_div li").each((_i, el) => {
    const t = $(el).text().split(":");
    if (t.length >= 2) pushSpec(t[0], t.slice(1).join(":"));
  });
  $(".andes-table tr, .ui-vpp-striped-specs__table tr").each(
    (_i, el) => pushSpec($(el).find("th").first().text(), $(el).find("td").first().text())
  );
  const description = clean(product?.description, 1500) || clean($("#productDescription").text(), 1500) || clean($(".ui-pdp-description__content").text(), 1500) || clean(meta("og:description", "description", "twitter:description"), 1500);
  const brand = clean(typeof product?.brand === "string" ? product.brand : product?.brand?.name, 80) || clean($("#bylineInfo").text().replace(/^(Marca|Visite a loja)\s*:?\s*/i, ""), 80) || specs.find((s) => /^marca$|^brand$/i.test(s.label))?.value || null;
  const priceCents = parsePriceToCents($("#corePrice_feature_div .a-price .a-offscreen").first().text()) || parsePriceToCents($("#corePriceDisplay_desktop_feature_div .a-price .a-offscreen").first().text()) || parsePriceToCents($(".a-price.priceToPay .a-offscreen").first().text()) || parsePriceToCents(offers?.price ?? offers?.lowPrice) || parsePriceToCents(meta("product:price:amount", "og:price:amount", "price")) || parsePriceToCents(
    $(".ui-pdp-price__second-line .andes-money-amount__fraction").first().text() + ($(".ui-pdp-price__second-line .andes-money-amount__cents").first().text() ? "," + $(".ui-pdp-price__second-line .andes-money-amount__cents").first().text() : "")
  );
  const originalPriceCents = parsePriceToCents($(".a-price.a-text-price .a-offscreen").first().text()) || parsePriceToCents($("s.andes-money-amount--previous .andes-money-amount__fraction").first().text()) || parsePriceToCents(offers?.highPrice);
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
    currency: String(offers?.priceCurrency || meta("product:price:currency", "og:price:currency") || "BRL").toUpperCase().slice(0, 3) || "BRL",
    rating: ratingRaw !== null && Number.isFinite(Number(ratingRaw)) ? Number(ratingRaw) : null,
    reviewCount: reviewRaw !== null && Number.isFinite(Number(reviewRaw)) ? Number(reviewRaw) : null,
    images: pool.list(),
    store: store.name,
    storeKey: store.key,
    available: detectAvailability($, offers, store.key)
  };
}
function findProductLink(html, finalUrl) {
  const store = detectStore(finalUrl).key;
  if (store === "mercadolivre") {
    const m = html.match(/https:\/\/(?:produto|www)\.mercadolivre\.com\.br\/(?:[^"'\s<>]*?\/)?(?:MLB-?\d{6,}|p\/MLB\d{6,})[^"'\s<>]*/i) || html.match(/https:\\\/\\\/(?:produto|www)\.mercadolivre\.com\.br\\\/[^"'\s<>]*?MLB-?\d{6,}[^"'\s<>]*/i);
    return m ? m[0].replace(/\\\//g, "/").replace(/&amp;/g, "&") : null;
  }
  return null;
}
function productIds(url) {
  const ml = url.match(/MLB-?(\d{6,})/i);
  const shopee = url.match(/-i\.(\d+)\.(\d+)/) || url.match(/\/product\/(\d+)\/(\d+)/);
  return {
    mercadoLivreItem: ml ? `MLB${ml[1]}` : null,
    shopee: shopee ? { shopId: shopee[1], itemId: shopee[2] } : null
  };
}

// src/services/shop-scraper/fetcher.ts
import { lookup } from "dns/promises";
import { isIP } from "net";
var BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.6,en;q=0.5",
  "Cache-Control": "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none"
};
var FetchProblem = class extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
  status;
};
var privateV4 = (h) => {
  const p = h.split(".").map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || p[0] === 169 && p[1] === 254 || p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && p[1] === 168 || p[0] === 100 && p[1] >= 64 && p[1] <= 127 || p[0] >= 224;
};
var privateV6 = (h) => {
  const x = h.toLowerCase().replace(/^\[|\]$/g, "");
  if (x === "::" || x === "::1") return true;
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return /^(fe[89ab]|fc|fd|ff)/.test(x);
};
async function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchProblem("Link inv\xE1lido. Cole a URL completa (come\xE7ando com https://).");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new FetchProblem("Use um link http(s).");
  if (u.username || u.password) throw new FetchProblem("Links com usu\xE1rio/senha n\xE3o s\xE3o aceitos.");
  if (u.port && !["80", "443"].includes(u.port)) throw new FetchProblem("Porta n\xE3o permitida.");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes("."))
    throw new FetchProblem("Endere\xE7o local n\xE3o \xE9 permitido.");
  const bad = (a, f) => f === 4 ? privateV4(a) : privateV6(a);
  if (isIP(host)) {
    if (bad(host, isIP(host))) throw new FetchProblem("Endere\xE7o da rede local n\xE3o \xE9 permitido.");
    return u;
  }
  const addrs = await lookup(host, { all: true }).catch(() => {
    throw new FetchProblem(`N\xE3o encontramos o site ${host}. Verifique o link.`);
  });
  if (!addrs.length || addrs.some((a) => bad(a.address, a.family)))
    throw new FetchProblem("Endere\xE7o da rede local n\xE3o \xE9 permitido.");
  return u;
}
async function readLimited(res, max) {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => void 0);
      throw new FetchProblem("Arquivo grande demais.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function fetchFollowing(rawUrl, opts = {}) {
  let current = (await assertPublicUrl(rawUrl)).toString();
  const jar = /* @__PURE__ */ new Map();
  const hops = [current];
  for (let hop = 0; hop <= 10; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15e3);
    let res;
    try {
      const headers = { ...BROWSER_HEADERS };
      if (opts.accept) headers.Accept = opts.accept;
      if (opts.referer) headers.Referer = opts.referer;
      if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      res = await fetch(current, { headers, redirect: "manual", signal: controller.signal });
    } catch (error) {
      const timeout = error instanceof Error && error.name === "AbortError";
      throw new FetchProblem(
        timeout ? "A loja demorou demais para responder. Tente de novo." : "N\xE3o foi poss\xEDvel abrir o link.",
        504
      );
    } finally {
      clearTimeout(timer);
    }
    const setCookies = res.headers.getSetCookie?.() || [];
    for (const c of setCookies) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      await res.arrayBuffer().catch(() => void 0);
      if (!location) throw new FetchProblem("Redirecionamento sem destino.");
      current = (await assertPublicUrl(new URL(location, current).toString())).toString();
      hops.push(current);
      continue;
    }
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const body = await readLimited(res, opts.maxBytes ?? 4 * 1024 * 1024);
    if (contentType.includes("html") && body.length < 6e4) {
      const html = body.toString("utf8");
      const next = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?\s*\d+\s*;\s*url=([^"'>\s]+)/i)?.[1] || html.match(/(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1] || html.match(/location\.replace\(\s*["'](https?:\/\/[^"']+)["']\s*\)/i)?.[1];
      if (next && hop < 10 && !/og:title|application\/ld\+json/i.test(html)) {
        current = (await assertPublicUrl(new URL(next.replace(/&amp;/g, "&"), current).toString())).toString();
        hops.push(current);
        continue;
      }
    }
    return { finalUrl: current, status: res.status, contentType, body, hops };
  }
  throw new FetchProblem("Redirecionamentos demais no link.");
}

// src/services/shop-scraper/preview.ts
async function json(url, headers = {}) {
  try {
    const res = await fetch(url, { headers: { ...BROWSER_HEADERS, Accept: "application/json", ...headers }, signal: AbortSignal.timeout(1e4) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
async function enrichMercadoLivre(data, itemId) {
  const item = await json(`https://api.mercadolibre.com/items/${itemId}`);
  if (!item || item.error) return false;
  const pics = (item.pictures || []).map((p) => p.secure_url || p.url).filter(Boolean);
  data.images = [.../* @__PURE__ */ new Set([...pics.map(upscaleImageUrl), ...data.images])].slice(0, 12);
  data.title ||= item.title || null;
  data.priceCents ||= parsePriceToCents(item.price);
  if (!data.originalPriceCents && item.original_price && item.original_price > (item.price || 0))
    data.originalPriceCents = parsePriceToCents(item.original_price);
  for (const a of item.attributes || []) {
    if (a?.name && a?.value_name && data.specs.length < 25 && !data.specs.some((s) => s.label === a.name))
      data.specs.push({ label: String(a.name), value: String(a.value_name) });
    if (!data.brand && /^(marca|brand)$/i.test(a?.name || "")) data.brand = a.value_name;
  }
  if (item.status) data.available = item.status === "active" && (item.available_quantity ?? 1) > 0;
  return true;
}
async function enrichShopee(data, ids, referer) {
  const r = await json(`https://shopee.com.br/api/v4/item/get?itemid=${ids.itemId}&shopid=${ids.shopId}`, {
    Referer: referer,
    "X-Requested-With": "XMLHttpRequest",
    "X-API-SOURCE": "pc"
  });
  const item = r?.data || r?.item;
  if (!item) return false;
  const hashes = item.images || (item.image ? [item.image] : []);
  data.images = [.../* @__PURE__ */ new Set([...hashes.map((h) => `https://down-br.img.susercontent.com/file/${h}`), ...data.images])].slice(0, 12);
  data.title ||= item.name || null;
  if (!data.priceCents && item.price) data.priceCents = Math.round(Number(item.price) / 1e3);
  if (!data.originalPriceCents && item.price_before_discount && item.price_before_discount > item.price)
    data.originalPriceCents = Math.round(Number(item.price_before_discount) / 1e3);
  data.description ||= item.description ? String(item.description).slice(0, 1500) : null;
  if (typeof item.stock === "number") data.available = item.stock > 0;
  return true;
}
async function previewProduct(inputUrl, affiliate) {
  const aff = applyAffiliate(inputUrl, affiliate);
  const warnings = [];
  let page = await fetchFollowing(inputUrl);
  let html = page.body.toString("utf8");
  if (page.status >= 400) {
    warnings.push(`A loja respondeu HTTP ${page.status}. Algumas lojas bloqueiam leitura autom\xE1tica; confira os campos.`);
  }
  if (!page.contentType.includes("html")) throw new FetchProblem("O link n\xE3o abriu uma p\xE1gina de produto.");
  let data = extractProductData(html, page.finalUrl);
  if (!data.priceCents || data.images.length === 0) {
    const productLink = findProductLink(html, page.finalUrl);
    if (productLink && productLink !== page.finalUrl) {
      try {
        const next = await fetchFollowing(productLink);
        const nextHtml = next.body.toString("utf8");
        const nextData = extractProductData(nextHtml, next.finalUrl);
        if (nextData.title) {
          page = next;
          html = nextHtml;
          data = nextData;
        }
      } catch {
      }
    }
  }
  const ids = productIds(page.finalUrl);
  if (data.storeKey === "mercadolivre" && ids.mercadoLivreItem && (data.images.length < 2 || !data.priceCents))
    await enrichMercadoLivre(data, ids.mercadoLivreItem);
  if (data.storeKey === "shopee" && ids.shopee && (data.images.length < 2 || !data.title))
    await enrichShopee(data, ids.shopee, page.finalUrl);
  if (/captcha|robot check|não é um robô|são um robô|unusual traffic/i.test(html.slice(0, 4e4)) && !data.priceCents)
    warnings.push("A loja pediu verifica\xE7\xE3o anti-rob\xF4. Abra o link no navegador uma vez e tente de novo, ou preencha \xE0 m\xE3o.");
  if (!data.title) warnings.push("N\xE3o encontramos o nome do produto.");
  if (!data.images.length) warnings.push("N\xE3o encontramos fotos. Envie uma imagem do seu computador.");
  if (!data.priceCents) warnings.push("Pre\xE7o n\xE3o encontrado (opcional).");
  return {
    ...data,
    store: data.store || detectStore(page.finalUrl).name,
    inputUrl,
    affiliateUrl: aff.url,
    finalUrl: page.finalUrl,
    applied: aff.applied,
    notes: aff.notes,
    warnings
  };
}

// src/services/shop-scraper/check.ts
var brl = (c) => c === null ? "\u2014" : `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
function evaluateCheck(current, found, http) {
  const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
  const base = { priceCents: found.priceCents, originalPriceCents: found.originalPriceCents, available: found.available, checkedAt };
  if (http.status === 404 || http.status === 410)
    return { ...base, status: "BROKEN", message: `A loja respondeu ${http.status}: o produto foi removido ou o link mudou.` };
  if (http.blocked && found.priceCents === null)
    return { ...base, status: "BLOCKED", message: "A loja pediu verifica\xE7\xE3o anti-rob\xF4; tentaremos de novo na pr\xF3xima rodada." };
  if (found.available === false) return { ...base, status: "OUT_OF_STOCK", message: "Produto esgotado ou an\xFAncio pausado." };
  if (!found.title && found.priceCents === null)
    return { ...base, status: "BROKEN", message: "A p\xE1gina n\xE3o mostra mais um produto (link quebrado ou redirecionado)." };
  if (found.priceCents !== null && current.priceCents !== null && found.priceCents !== current.priceCents)
    return {
      ...base,
      status: "PRICE_CHANGED",
      message: `Pre\xE7o mudou de ${brl(current.priceCents)} para ${brl(found.priceCents)}.`
    };
  return { ...base, status: "OK", message: found.priceCents !== null ? `Pre\xE7o confirmado: ${brl(found.priceCents)}.` : "Link funcionando." };
}
async function checkProduct(current) {
  try {
    const p = await previewProduct(current.affiliateUrl, { autoApply: false });
    const blocked = p.warnings.some((w) => /anti-robô/.test(w));
    const httpWarn = p.warnings.find((w) => /HTTP (\d{3})/.test(w));
    const status = httpWarn ? Number(httpWarn.match(/HTTP (\d{3})/)[1]) : 200;
    return evaluateCheck(current, p, { status, blocked });
  } catch (error) {
    const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
    const empty = { priceCents: null, originalPriceCents: null, available: null, checkedAt };
    if (error instanceof FetchProblem && error.status === 504)
      return { ...empty, status: "BLOCKED", message: "A loja n\xE3o respondeu a tempo; nova tentativa depois." };
    return {
      ...empty,
      status: "BROKEN",
      message: error instanceof Error ? error.message : "N\xE3o foi poss\xEDvel abrir o link."
    };
  }
}

// src/shop-worker.ts
var PORT = Number(process.env.SHOP_WORKER_HEALTH_PORT || 4040);
var ROUND_MS = Number(process.env.SHOP_WORKER_ROUND_MS || 15 * 6e4);
var state = {
  startedAt: (/* @__PURE__ */ new Date()).toISOString(),
  lastRoundAt: null,
  checked: 0,
  changed: 0,
  hidden: 0,
  lastError: null,
  busy: false
};
async function round() {
  if (state.busy) return;
  state.busy = true;
  state.lastRoundAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const due = await productsDueForCheck(25);
    for (const p of due) {
      const result = await checkProduct(p);
      const updated = await applyCheckResult(p.id, result);
      state.checked++;
      if (result.status === "PRICE_CHANGED") state.changed++;
      if (updated?.autoHidden) state.hidden++;
      console.log(`[shop] ${result.status.padEnd(13)} ${p.title.slice(0, 60)} \u2014 ${result.message}`);
      await sleep(6e3 + Math.random() * 8e3);
    }
    state.lastError = null;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    console.error("[shop] rodada falhou:", state.lastError);
  } finally {
    state.busy = false;
  }
}
createServer((req, res) => {
  if (req.url === "/run" && req.method === "POST") {
    void round();
    res.writeHead(202, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, accepted: true }));
  }
  res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "hypeverso-shop-worker", ...state }));
}).listen(PORT, "0.0.0.0", () => console.log(`[shop] worker ativo; sa\xFAde em :${PORT}/health`));
await prisma.$connect();
await round();
setInterval(() => void round(), ROUND_MS);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
//# sourceMappingURL=shop-worker.js.map