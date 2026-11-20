import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { localizeShopList } from '../services/translation.js';
import { nanoid } from 'nanoid';
import { prisma, Prisma } from '../db.js';
import { requireRole, optionalUser } from '../lib/auth.js';
import { slugify, sha256 } from '../lib/security.js';
import { clientIp } from '../lib/client-ip.js';
import { redis, delCache, getCache, setCache } from '../lib/redis.js';
import { detectStore, isAcceptableAffiliateUrl } from '../services/shop.js';
import { stringList } from '../lib/json-array.js';
import { applyCheckResult } from '../services/shop-check.js';

const PUBLIC_CACHE_KEY = 'shop:public:v1';
const PUBLIC_CACHE_TTL = 60;

const publicSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  imageUrl: true,
  store: true,
  category: true,
  badge: true,
  priceCents: true,
  originalPriceCents: true,
  currency: true,
  couponCode: true,
  highlights: true,
  featured: true,
  updatedAt: true,
} satisfies Prisma.ShopProductSelect;

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(v => {
    try {
      return ['http:', 'https:'].includes(new URL(v).protocol);
    } catch {
      return false;
    }
  }, 'Informe uma URL http(s) válida');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform(v => (v ? v : null));

const cents = z.coerce.number().int().min(0).max(1_000_000_000).nullish();

const productFields = {
  affiliateUrl: httpUrl,
  title: z.string().trim().min(2).max(200),
  description: optionalText(1000),
  imageUrl: z
    .union([httpUrl, z.literal('')])
    .nullish()
    .transform(v => (v ? v : null)),
  store: optionalText(60),
  category: optionalText(60),
  badge: optionalText(40),
  priceCents: cents,
  originalPriceCents: cents,
  currency: z.string().trim().length(3).toUpperCase(),
  couponCode: optionalText(60),
  highlights: z.array(z.string().trim().min(2).max(140)).max(8).nullish(),
  featured: z.boolean(),
  active: z.boolean(),
  sortOrder: z.coerce.number().int().min(-10000).max(10000),
};

const productCreate = z.object({
  ...productFields,
  currency: productFields.currency.default('BRL'),
  featured: productFields.featured.default(false),
  active: productFields.active.default(true),
  sortOrder: productFields.sortOrder.default(0),
});

// PATCH: só altera o que foi enviado (sem defaults que sobrescrevam valores).
const productPatch = z.object(productFields).partial();

async function uniqueSlug(title: string, ignoreId?: string) {
  const base = slugify(title).slice(0, 80) || 'produto';
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}-${nanoid(6).toLowerCase()}`;
    const exists = await prisma.shopProduct.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists || exists.id === ignoreId) return candidate;
  }
  return `${base}-${nanoid(10).toLowerCase()}`;
}

async function invalidatePublicCache() {
  await delCache('shop:public:*').catch(() => undefined);
}

type PublicProduct = Prisma.ShopProductGetPayload<{ select: typeof publicSelect }>;
type CollectionRow = Prisma.ShopCollectionGetPayload<object>;

async function activeProducts(): Promise<PublicProduct[]> {
  let all = await getCache<PublicProduct[]>(PUBLIC_CACHE_KEY).catch(() => null);
  if (!all) {
    all = await prisma.shopProduct.findMany({
      where: { active: true },
      orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: publicSelect,
      take: 500,
    });
    await setCache(PUBLIC_CACHE_KEY, all, PUBLIC_CACHE_TTL).catch(() => undefined);
  }
  return all;
}

async function publicCollections(): Promise<CollectionRow[]> {
  const key = 'shop:public:collections';
  const cached = await getCache<CollectionRow[]>(key).catch(() => null);
  if (cached) return cached;
  const rows = await prisma.shopCollection.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
  await setCache(key, rows, PUBLIC_CACHE_TTL).catch(() => undefined);
  return rows;
}

function publicCollection(c: CollectionRow) {
  return { slug: c.slug, title: c.title, description: c.description, emoji: c.emoji };
}

/** Produtos de uma coleção: os escolhidos à mão (na ordem) + os que batem com os filtros. */
export function collectionItems<T extends { id: string; category: string | null; store: string; priceCents: number | null; originalPriceCents: number | null }>(
  c: Pick<CollectionRow, 'productIds' | 'category' | 'store' | 'maxPriceCents' | 'onlyDiscount'>,
  all: T[],
) {
  const manual = stringList(c.productIds);
  const picked = manual.map(id => all.find(p => p.id === id)).filter((p): p is T => Boolean(p));
  const hasFilter = Boolean(c.category || c.store || c.maxPriceCents || c.onlyDiscount);
  const filtered = hasFilter
    ? all.filter(
        p =>
          !manual.includes(p.id) &&
          (!c.category || p.category === c.category) &&
          (!c.store || p.store === c.store) &&
          (!c.maxPriceCents || (p.priceCents !== null && p.priceCents <= c.maxPriceCents)) &&
          (!c.onlyDiscount || (p.originalPriceCents !== null && p.priceCents !== null && p.originalPriceCents > p.priceCents)),
      )
    : [];
  return [...picked, ...filtered];
}

const collectionFields = {
  title: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9-]*$/, 'Use letras minúsculas, números e hífen'),
  description: optionalText(1000),
  emoji: optionalText(16),
  category: optionalText(60),
  store: optionalText(60),
  maxPriceCents: z.coerce.number().int().min(0).max(1_000_000_000).nullish(),
  onlyDiscount: z.boolean(),
  productIds: z.array(z.string().max(40)).max(200),
  active: z.boolean(),
  showOnShop: z.boolean(),
  sortOrder: z.coerce.number().int().min(-10000).max(10000),
};
const collectionInput = z.object({
  ...collectionFields,
  slug: collectionFields.slug.optional(),
  onlyDiscount: collectionFields.onlyDiscount.default(false),
  productIds: collectionFields.productIds.default([]),
  active: collectionFields.active.default(true),
  showOnShop: collectionFields.showOnShop.default(true),
  sortOrder: collectionFields.sortOrder.default(0),
});
// PATCH: só o que foi enviado (sem defaults).
const collectionPatch = z.object(collectionFields).partial();

const shopRoutes: FastifyPluginAsync = async app => {
  const editor = async (req: any, reply: any) => requireRole('EDITOR', 'ADMIN')(req, reply);

  // ---------------------------------------------------------------- público
  app.get('/shop/products', async (req, reply) => {
    const q = z
      .object({
        category: z.string().trim().max(60).optional(),
        store: z.string().trim().max(60).optional(),
        q: z.string().trim().max(80).optional(),
        /** Lista de IDs ou slugs (produtos dentro de artigos): devolve nessa ordem. */
        ids: z.string().trim().max(1000).optional(),
        locale: z.string().max(10).optional(),
      })
      .parse(req.query ?? {});
    reply.header('cache-control', 'public, max-age=30, stale-while-revalidate=120');

    // A lista completa é pequena e muda pouco: cacheamos uma vez e filtramos em memória.
    const all = await activeProducts();
    if (q.ids) {
      const wanted = q.ids.split(',').map(v => v.trim()).filter(Boolean).slice(0, 20);
      const items = wanted
        .map(key => all.find(p => p.id === key || p.slug === key))
        .filter((p): p is PublicProduct => Boolean(p));
      return { items: await localizeShopList(items, q.locale), categories: [], stores: [], collections: [], total: items.length };
    }
    const term = q.q?.toLowerCase();
    const items = all.filter(
      p =>
        (!q.category || p.category === q.category) &&
        (!q.store || p.store === q.store) &&
        (!term || `${p.title} ${p.description || ''} ${p.store} ${p.category || ''}`.toLowerCase().includes(term)),
    );
    const uniq = (values: (string | null)[]) =>
      [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const collections = await publicCollections();
    return {
      items: await localizeShopList(items, q.locale),
      categories: uniq(all.map(p => p.category)),
      stores: uniq(all.map(p => p.store)),
      collections: collections.filter(c => c.showOnShop).map(({ slug, title, emoji }) => ({ slug, title, emoji })),
      total: items.length,
    };
  });

  app.get('/shop/collections/:slug', async (req, reply) => {
    const { slug } = z.object({ slug: z.string().trim().min(1).max(120) }).parse(req.params);
    const { locale } = z.object({ locale: z.string().max(10).optional() }).parse(req.query ?? {});
    const collection = (await publicCollections()).find(c => c.slug === slug);
    if (!collection) return reply.code(404).send({ error: 'Coleção não encontrada' });
    reply.header('cache-control', 'public, max-age=30, stale-while-revalidate=120');
    const all = await activeProducts();
    return { collection: publicCollection(collection), items: await localizeShopList(collectionItems(collection, all), locale) };
  });

  /**
   * Clique em "Comprar": contabiliza e redireciona para o link de afiliado.
   * Usado como href (target=_blank) para não ser bloqueado como pop-up.
   */
  app.get('/shop/go/:id', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(120) }).parse(req.params);
    // Página onde o clique aconteceu (/shop, /shop/c/..., /post/...): vira o relatório por origem.
    const { src } = z.object({ src: z.string().max(300).optional() }).parse(req.query ?? {});
    const source = src && /^\/[A-Za-z0-9/_\-.%]*$/.test(src) ? src : '/shop';
    const product = await prisma.shopProduct.findFirst({
      where: { OR: [{ id }, { slug: id }], active: true },
      select: { id: true, affiliateUrl: true, store: true },
    });
    reply.header('cache-control', 'no-store');
    reply.header('x-robots-tag', 'noindex, nofollow');
    if (!product) return reply.redirect('/shop', 302);

    // Conta no máximo 1 clique por visitante/produto a cada 30 min.
    let count = true;
    try {
      const viewer = sha256(`${clientIp(req)}|${req.headers['user-agent'] || ''}`).slice(0, 24);
      count = (await redis.set(`shop:click:${product.id}:${viewer}`, '1', 'EX', 1800, 'NX')) === 'OK';
    } catch {}
    if (count) {
      const viewer = await optionalUser(req);
      await prisma
        .$transaction([
          prisma.shopProduct.update({
            where: { id: product.id },
            data: { clicks: { increment: 1 }, lastClickedAt: new Date() },
          }),
          prisma.analyticsEvent.create({
            data: {
              type: 'AFFILIATE_CLICK',
              path: source,
              userId: viewer?.id,
              metadata: { store: product.store, productId: product.id, source: 'shop' },
            },
          }),
        ])
        .catch(error => req.log.warn({ err: error }, 'Falha ao contabilizar clique da Shop'));
    }
    return reply.redirect(product.affiliateUrl, 302);
  });

  // ---------------------------------------------------------------- CMS
  app.get('/admin/shop/products', { preHandler: editor }, async () => {
    const items = await prisma.shopProduct.findMany({
      orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 1000,
    });
    const since = new Date(Date.now() - 30 * 86400000);
    const clicks30d = await prisma.analyticsEvent.count({
      where: { type: 'AFFILIATE_CLICK', createdAt: { gte: since } },
    });
    return {
      items,
      stats: {
        total: items.length,
        active: items.filter(p => p.active).length,
        clicks: items.reduce((sum, p) => sum + p.clicks, 0),
        clicks30d,
        alerts: items.filter(p => ['BROKEN', 'OUT_OF_STOCK'].includes(p.checkStatus)).length,
      },
    };
  });

  app.post('/admin/shop/products', { preHandler: editor }, async (req, reply) => {
    const data = productCreate.parse(req.body);
    if (!isAcceptableAffiliateUrl(data.affiliateUrl))
      return reply.code(400).send({ error: 'Link de afiliado inválido.' });
    const product = await prisma.shopProduct.create({
      data: {
        ...data,
        highlights: data.highlights ?? undefined,
        store: data.store || detectStore(data.affiliateUrl),
        slug: await uniqueSlug(data.title),
        createdById: req.authUser!.id,
      },
    });
    await invalidatePublicCache();
    return reply.code(201).send(product);
  });

  app.patch('/admin/shop/products/:id', { preHandler: editor }, async req => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const body = productPatch.parse(req.body);
    const current = await prisma.shopProduct.findUniqueOrThrow({ where: { id } });
    if (body.affiliateUrl && !isAcceptableAffiliateUrl(body.affiliateUrl))
      throw Object.assign(new Error('Link de afiliado inválido.'), { statusCode: 400 });
    const { store, highlights, ...data } = body;
    const updated = await prisma.shopProduct.update({
      where: { id },
      data: {
        ...data,
        ...(highlights !== undefined ? { highlights: highlights ?? Prisma.DbNull } : {}),
        // Mudança manual de visibilidade tira o controle automático.
        ...(data.active !== undefined ? { autoHidden: false } : {}),
        // Loja apagada no formulário = detectar de novo pelo domínio do link.
        ...(store !== undefined ? { store: store || detectStore(data.affiliateUrl || current.affiliateUrl) } : {}),
        ...(data.title && data.title !== current.title ? { slug: await uniqueSlug(data.title, id) } : {}),
      },
    });
    await invalidatePublicCache();
    return updated;
  });

  app.delete('/admin/shop/products/:id', { preHandler: editor }, async (_req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(_req.params);
    await prisma.shopProduct.delete({ where: { id } });
    await invalidatePublicCache();
    return reply.code(204).send();
  });

  // ------------------------------------------------ verificação, histórico, relatório
  const checkResultInput = z.object({
    status: z.enum(['OK', 'PRICE_CHANGED', 'OUT_OF_STOCK', 'BROKEN', 'BLOCKED']),
    message: z.string().max(500),
    priceCents: z.number().int().min(0).nullable(),
    originalPriceCents: z.number().int().min(0).nullable(),
    available: z.boolean().nullable(),
    checkedAt: z.string().max(40),
  });

  /** Resultado do botão "Verificar agora" do CMS (a leitura da loja acontece no seu PC). */
  app.post('/admin/shop/products/:id/check-result', { preHandler: editor }, async req => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const result = checkResultInput.parse(req.body);
    return applyCheckResult(id, result);
  });

  app.get('/admin/shop/products/:id/history', { preHandler: editor }, async req => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    return prisma.shopPriceHistory.findMany({ where: { productId: id }, orderBy: { checkedAt: 'asc' }, take: 365 });
  });

  app.get('/admin/shop/report', { preHandler: editor }, async req => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query ?? {});
    const since = new Date(Date.now() - days * 86400000);
    const events = await prisma.analyticsEvent.findMany({
      where: { type: 'AFFILIATE_CLICK', createdAt: { gte: since } },
      select: { createdAt: true, path: true, metadata: true },
      take: 200_000,
    });
    const products = await prisma.shopProduct.findMany({
      select: { id: true, title: true, store: true, imageUrl: true, priceCents: true, clicks: true },
    });
    const byId = new Map(products.map(p => [p.id, p]));
    const perDay = new Map<string, number>();
    const perStore = new Map<string, number>();
    const perProduct = new Map<string, number>();
    const perSource = new Map<string, number>();
    for (const e of events) {
      const day = e.createdAt.toISOString().slice(0, 10);
      perDay.set(day, (perDay.get(day) || 0) + 1);
      const meta = (e.metadata || {}) as Record<string, unknown>;
      const store = String(meta.store || 'Outros');
      perStore.set(store, (perStore.get(store) || 0) + 1);
      if (typeof meta.productId === 'string') perProduct.set(meta.productId, (perProduct.get(meta.productId) || 0) + 1);
      // Agrupa artigos sob /post/<slug>, coleções sob /shop/c/<slug>.
      const source = (e.path || '/shop').split('?')[0];
      perSource.set(source, (perSource.get(source) || 0) + 1);
    }
    const days_: { day: string; clicks: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      days_.push({ day, clicks: perDay.get(day) || 0 });
    }
    const sort = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return {
      days,
      total: events.length,
      perDay: days_,
      perStore: sort(perStore).map(([store, clicks]) => ({ store, clicks })),
      perSource: sort(perSource)
        .slice(0, 30)
        .map(([source, clicks]) => ({ source, clicks })),
      topProducts: sort(perProduct)
        .slice(0, 30)
        .map(([id, clicks]) => ({ id, clicks, product: byId.get(id) || null })),
    };
  });

  // ------------------------------------------------ coleções (CMS)
  app.get('/admin/shop/collections', { preHandler: editor }, async () => {
    const [rows, all] = await Promise.all([
      prisma.shopCollection.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] }),
      prisma.shopProduct.findMany({
        where: { active: true },
        select: { id: true, category: true, store: true, priceCents: true, originalPriceCents: true },
      }),
    ]);
    return rows.map(r => ({ ...r, productIds: stringList(r.productIds), count: collectionItems(r, all).length }));
  });

  async function uniqueCollectionSlug(base: string, ignoreId?: string) {
    const root = slugify(base).slice(0, 70) || 'colecao';
    for (let i = 0; i < 20; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      const exists = await prisma.shopCollection.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!exists || exists.id === ignoreId) return candidate;
    }
    return `${root}-${nanoid(6).toLowerCase()}`;
  }

  app.post('/admin/shop/collections', { preHandler: editor }, async (req, reply) => {
    const body = collectionInput.parse(req.body);
    const created = await prisma.shopCollection.create({
      data: { ...body, slug: await uniqueCollectionSlug(body.slug || body.title) },
    });
    await invalidatePublicCache();
    return reply.code(201).send(created);
  });

  app.patch('/admin/shop/collections/:id', { preHandler: editor }, async req => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const body = collectionPatch.parse(req.body);
    const updated = await prisma.shopCollection.update({
      where: { id },
      data: { ...body, ...(body.slug ? { slug: await uniqueCollectionSlug(body.slug, id) } : {}) },
    });
    await invalidatePublicCache();
    return updated;
  });

  app.delete('/admin/shop/collections/:id', { preHandler: editor }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    await prisma.shopCollection.delete({ where: { id } });
    await invalidatePublicCache();
    return reply.code(204).send();
  });
};

export default shopRoutes;
