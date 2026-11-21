import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { stringList } from '../lib/json-array.js';
import { getAllSettings, TRANSLATION_LOCALES, type TranslationLocale } from './settings.js';

/**
 * Traduções automáticas com a IA local (Ollama no seu PC).
 *
 * - O original (pt-BR) nunca é alterado: as versões ficam em ContentTranslation.
 * - O HTML do artigo é traduzido "texto por texto": a estrutura (tags, links,
 *   imagens, códigos [[produto:...]]) é mantida exatamente como está.
 * - Quando o original muda, a tradução é refeita sozinha, exceto se alguém
 *   editou a tradução no CMS (manualEdit): aí o CMS mostra "original mudou".
 */

export type EntityType = 'post' | 'shop';
export const ENTITY_TYPES: EntityType[] = ['post', 'shop'];

export function isTranslationLocale(v: unknown): v is TranslationLocale {
  return typeof v === 'string' && (TRANSLATION_LOCALES as readonly string[]).includes(v);
}

/** "en-US" → "en"; "pt-BR"/vazio → null (original). */
export function normalizeLocale(v: unknown): TranslationLocale | null {
  const base = String(v || '')
    .toLowerCase()
    .split(/[-_]/)[0];
  return isTranslationLocale(base) ? base : null;
}

const LANGUAGE_NAME: Record<TranslationLocale, string> = {
  en: 'English (United States)',
  es: 'Spanish (neutral Latin American)',
};

// ---------------------------------------------------------------- fontes

export type PostSource = {
  id: string;
  title: string;
  description: string;
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
};
export type ShopSource = {
  id: string;
  title: string;
  description: string | null;
  highlights: unknown;
  badge: string | null;
};

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

export function postHash(p: Omit<PostSource, 'id'>) {
  return sha(['post:v1', p.title, p.description, p.content, p.seoTitle || '', p.seoDescription || ''].join('␞'));
}
export function shopHash(p: Omit<ShopSource, 'id'>) {
  return sha(['shop:v1', p.title, p.description || '', stringList(p.highlights).join('\n'), p.badge || ''].join('␞'));
}

// ---------------------------------------------------------------- leitura (site)

type TranslationRow = Awaited<ReturnType<typeof prisma.contentTranslation.findMany>>[number];

async function visibleTranslations(entityType: EntityType, ids: string[], locale: TranslationLocale) {
  if (!ids.length) return new Map<string, TranslationRow>();
  const settings = await getAllSettings();
  if (!settings.translation.enabled || !settings.translation.locales.includes(locale)) return new Map();
  const rows = await prisma.contentTranslation.findMany({
    where: {
      entityType,
      locale,
      entityId: { in: ids },
      status: 'DONE',
      ...(settings.translation.requireReview ? { reviewedAt: { not: null } } : {}),
    },
  });
  return new Map(rows.map(r => [r.entityId, r]));
}

type TranslationInfo = { locale: string; translated: boolean };

/** Aplica a tradução (se existir) a uma lista de posts com title/description. */
export async function localizePostList<T extends { id: string; title: string; description: string }>(
  items: T[],
  rawLocale: unknown,
): Promise<(T & { translation?: TranslationInfo })[]> {
  const locale = normalizeLocale(rawLocale);
  if (!locale || !items.length) return items;
  const map = await visibleTranslations(
    'post',
    items.map(i => i.id),
    locale,
  );
  return items.map(i => {
    const t = map.get(i.id);
    if (!t) return { ...i, translation: { locale, translated: false } };
    return {
      ...i,
      title: t.title || i.title,
      description: t.description || i.description,
      translation: { locale, translated: true },
    };
  });
}

/** Artigo completo. Conteúdo traduzido só substitui quando existe. */
export async function localizePost<
  T extends { id: string; title: string; description: string; content: string; seoTitle?: string | null; seoDescription?: string | null },
>(post: T, rawLocale: unknown) {
  const locale = normalizeLocale(rawLocale);
  const available = await availablePostLocales(post.id);
  if (!locale) return { ...post, locale: 'pt-BR', availableLocales: available };
  const t = (await visibleTranslations('post', [post.id], locale)).get(post.id);
  if (!t) return { ...post, locale: 'pt-BR', requestedLocale: locale, availableLocales: available, translation: { locale, translated: false } };
  return {
    ...post,
    title: t.title || post.title,
    description: t.description || post.description,
    content: post.content && t.content ? t.content : post.content,
    seoTitle: t.seoTitle || post.seoTitle || null,
    seoDescription: t.seoDescription || post.seoDescription || null,
    locale,
    availableLocales: available,
    translation: { locale, translated: true, reviewed: Boolean(t.reviewedAt), translatedAt: t.translatedAt },
  };
}

/** Idiomas em que o artigo pode ser lido (para hreflang e sitemap). */
export async function availablePostLocales(postId: string): Promise<string[]> {
  const settings = await getAllSettings();
  if (!settings.translation.enabled) return ['pt-BR'];
  const rows = await prisma.contentTranslation.findMany({
    where: {
      entityType: 'post',
      entityId: postId,
      status: 'DONE',
      locale: { in: settings.translation.locales },
      ...(settings.translation.requireReview ? { reviewedAt: { not: null } } : {}),
    },
    select: { locale: true },
  });
  return ['pt-BR', ...rows.map(r => r.locale)];
}

/** Idiomas disponíveis de vários artigos de uma vez (sitemap com hreflang). */
export async function localesForPosts(ids: string[]) {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const settings = await getAllSettings();
  if (!settings.translation.enabled) return out;
  const rows = await prisma.contentTranslation.findMany({
    where: {
      entityType: 'post',
      entityId: { in: ids },
      status: 'DONE',
      locale: { in: settings.translation.locales },
      ...(settings.translation.requireReview ? { reviewedAt: { not: null } } : {}),
    },
    select: { entityId: true, locale: true },
  });
  for (const r of rows) out.set(r.entityId, [...(out.get(r.entityId) || []), r.locale]);
  return out;
}

export async function localizeShopList<T extends { id: string; title: string; description: string | null; highlights?: unknown; badge?: string | null }>(
  items: T[],
  rawLocale: unknown,
): Promise<T[]> {
  const locale = normalizeLocale(rawLocale);
  if (!locale || !items.length) return items;
  const settings = await getAllSettings();
  if (!settings.translation.translateShop) return items;
  const map = await visibleTranslations(
    'shop',
    items.map(i => i.id),
    locale,
  );
  return items.map(i => {
    const t = map.get(i.id);
    if (!t) return i;
    const extra = (t.extra || {}) as { highlights?: string[]; badge?: string };
    return {
      ...i,
      title: t.title || i.title,
      description: t.description ?? i.description,
      highlights: extra.highlights?.length ? extra.highlights : i.highlights,
      badge: extra.badge || i.badge,
    };
  });
}

// ---------------------------------------------------------------- fila

const PUBLIC_POST = () => {
  const now = new Date();
  return {
    OR: [
      { status: 'PUBLISHED' as const, publishedAt: { lte: now } },
      { status: 'SCHEDULED' as const, scheduledAt: { lte: now } },
    ],
  };
};

/**
 * Confere todos os artigos publicados (e produtos ativos) e coloca na fila o que
 * ainda não tem tradução ou cujo original mudou. Barato: só compara hashes.
 */
export async function enqueueMissingTranslations(limit = 500) {
  const settings = await getAllSettings();
  if (!settings.translation.enabled) return { queued: 0 };
  const locales = settings.translation.locales;
  let queued = 0;

  const sync = async (entityType: EntityType, sources: { id: string; hash: string }[]) => {
    if (!sources.length) return;
    const existing = await prisma.contentTranslation.findMany({
      where: { entityType, entityId: { in: sources.map(s => s.id) }, locale: { in: locales } },
      select: { id: true, entityId: true, locale: true, sourceHash: true, manualEdit: true, status: true },
    });
    const byKey = new Map(existing.map(e => [`${e.entityId}:${e.locale}`, e]));
    for (const s of sources) {
      for (const locale of locales) {
        const row = byKey.get(`${s.id}:${locale}`);
        if (!row) {
          await prisma.contentTranslation
            .create({ data: { entityType, entityId: s.id, locale, sourceHash: s.hash, status: 'PENDING' } })
            .catch(() => undefined); // corrida com outro worker: já existe
          queued++;
        } else if (row.sourceHash !== s.hash && !row.manualEdit && row.status !== 'PENDING' && row.status !== 'PROCESSING') {
          await prisma.contentTranslation.update({
            where: { id: row.id },
            data: { status: 'PENDING', sourceHash: s.hash, attempts: 0, error: null },
          });
          queued++;
        }
      }
    }
  };

  const posts = await prisma.post.findMany({
    where: PUBLIC_POST(),
    select: { id: true, title: true, description: true, content: true, seoTitle: true, seoDescription: true },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });
  await sync(
    'post',
    posts.map(p => ({ id: p.id, hash: postHash(p) })),
  );

  if (settings.translation.translateShop) {
    const products = await prisma.shopProduct.findMany({
      where: { active: true },
      select: { id: true, title: true, description: true, highlights: true, badge: true },
      take: limit,
    });
    await sync(
      'shop',
      products.map(p => ({ id: p.id, hash: shopHash(p) })),
    );
  }
  return { queued };
}

/** Pede para refazer (botão "Traduzir de novo" no CMS). Descarta edições manuais. */
export async function requestRetranslation(entityType: EntityType, entityId: string, locales?: string[]) {
  const settings = await getAllSettings();
  const targets = (locales?.length ? locales : settings.translation.locales).filter(isTranslationLocale);
  const hash = await currentHash(entityType, entityId);
  if (!hash) return 0;
  for (const locale of targets) {
    await prisma.contentTranslation.upsert({
      where: { entityType_entityId_locale: { entityType, entityId, locale } },
      create: { entityType, entityId, locale, sourceHash: hash, status: 'PENDING' },
      update: { status: 'PENDING', sourceHash: hash, manualEdit: false, reviewedAt: null, attempts: 0, error: null, lockedAt: null },
    });
  }
  return targets.length;
}

export async function currentHash(entityType: EntityType, entityId: string) {
  if (entityType === 'post') {
    const p = await prisma.post.findUnique({
      where: { id: entityId },
      select: { title: true, description: true, content: true, seoTitle: true, seoDescription: true },
    });
    return p ? postHash(p) : null;
  }
  const s = await prisma.shopProduct.findUnique({
    where: { id: entityId },
    select: { title: true, description: true, highlights: true, badge: true },
  });
  return s ? shopHash(s) : null;
}

// ---------------------------------------------------------------- IA

type ChatOptions = { model: string; temperature?: number; timeoutMs?: number };

async function ollamaJson<T>(system: string, user: string, schema: object, opts: ChatOptions): Promise<T> {
  const res = await fetch(new URL('/api/chat', env.OLLAMA_URL).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 240_000),
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      think: false,
      format: schema,
      keep_alive: '10m',
      options: { temperature: opts.temperature ?? 0.2, num_ctx: 8192, num_predict: 4096 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404 && /model/i.test(body)) throw new Error(`Modelo ${opts.model} não está instalado no Ollama`);
    throw new Error(`Ollama respondeu ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const raw = data.message?.content || '';
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error('A IA não devolveu JSON válido');
  }
}

function systemPrompt(locale: TranslationLocale) {
  return [
    `You are a professional translator for a Brazilian pop-culture and geek news site (movies, series, games, anime, comics, tech).`,
    `Translate from Brazilian Portuguese into ${LANGUAGE_NAME[locale]}.`,
    `Rules:`,
    `- Translate meaning naturally, like a native editor would write it. Keep the same tone.`,
    `- Use the OFFICIAL title in the target language for movies, series, games and books when one exists; otherwise keep the original name.`,
    `- Never translate brand names, people names, usernames, URLs, e-mails, prices, numbers, dates' numeric parts or codes like [[produto:slug]].`,
    `- Do not add explanations, notes or quotes. Do not summarize. Do not omit anything.`,
    `- Keep leading/trailing spaces and punctuation consistent with the source.`,
  ].join('\n');
}

const ITEMS_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'string' } } },
  required: ['items'],
};

/** Traduz uma lista de trechos mantendo a ordem (lotes pequenos para o modelo não se perder). */
export async function translateSegments(segments: string[], locale: TranslationLocale, model: string): Promise<string[]> {
  const out: string[] = new Array(segments.length);
  let batch: number[] = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    const input = batch.map(i => segments[i]);
    let result: string[] | null = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      const r = await ollamaJson<{ items?: unknown }>(
        systemPrompt(locale),
        `Translate each string of this JSON array. Return {"items": [...]} with EXACTLY ${input.length} strings, same order.\n\n` +
          JSON.stringify(input),
        ITEMS_SCHEMA,
        { model, temperature: attempt ? 0 : 0.2 },
      );
      const items = Array.isArray(r.items) ? r.items.map(v => String(v ?? '')) : [];
      if (items.length === input.length) result = items;
    }
    if (!result) {
      // Último recurso: um por um (mais lento, mas não desalinha).
      result = [];
      for (const s of input) {
        const r = await ollamaJson<{ items?: unknown }>(
          systemPrompt(locale),
          `Translate this JSON array with ONE string. Return {"items": ["..."]}.\n\n${JSON.stringify([s])}`,
          ITEMS_SCHEMA,
          { model, temperature: 0 },
        );
        result.push(Array.isArray(r.items) && r.items[0] !== undefined ? String(r.items[0]) : s);
      }
    }
    batch.forEach((idx, k) => (out[idx] = result![k]));
    batch = [];
    size = 0;
  };
  for (let i = 0; i < segments.length; i++) {
    const len = segments[i].length;
    if (batch.length && (size + len > 2200 || batch.length >= 30)) await flush();
    batch.push(i);
    size += len;
  }
  await flush();
  return out;
}

const SKIP_TEXT = /^[\s\d\p{P}\p{S}]*$/u; // só números/pontuação/emoji
const CODE_ONLY = /^\s*(\[\[[^\]]+\]\]\s*)+$/;
const URL_ONLY = /^\s*(https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+)\s*$/i;

/** Traduz só os textos do HTML; tags, atributos e códigos ficam intactos. */
export async function translateHtml(html: string, locale: TranslationLocale, model: string) {
  if (!html.trim()) return html;
  const $ = cheerio.load(html, null, false);
  const nodes: { set: (v: string) => void; text: string }[] = [];
  const walk = (el: any) => {
    for (const child of el.children || []) {
      if (child.type === 'text') {
        const raw: string = child.data || '';
        if (!raw.trim() || SKIP_TEXT.test(raw) || CODE_ONLY.test(raw) || URL_ONLY.test(raw)) continue;
        const lead = raw.match(/^\s*/)![0];
        const trail = raw.match(/\s*$/)![0];
        nodes.push({ text: raw.trim(), set: v => (child.data = lead + v.trim() + trail) });
      } else if (child.type === 'tag') {
        if (['script', 'style', 'code', 'pre', 'kbd', 'samp'].includes(child.name)) continue;
        for (const attr of ['alt', 'title']) {
          const v = child.attribs?.[attr];
          if (v && v.trim() && !SKIP_TEXT.test(v)) nodes.push({ text: v.trim(), set: t => (child.attribs[attr] = t.trim()) });
        }
        walk(child);
      }
    }
  };
  walk($.root()[0]);
  if (!nodes.length) return html;
  const translated = await translateSegments(
    nodes.map(n => n.text),
    locale,
    model,
  );
  nodes.forEach((n, i) => n.set(translated[i] || n.text));
  return $.html();
}

async function activeModel() {
  const settings = await getAllSettings();
  return settings.translation.model.trim() || env.OLLAMA_MODEL;
}

async function translatePost(row: TranslationRow) {
  const post = await prisma.post.findUnique({
    where: { id: row.entityId },
    select: { title: true, description: true, content: true, seoTitle: true, seoDescription: true },
  });
  if (!post) return null;
  const locale = row.locale as TranslationLocale;
  const model = await activeModel();
  const fields = [post.title, post.description, post.seoTitle || '', post.seoDescription || ''];
  const [title, description, seoTitle, seoDescription] = await translateSegments(fields, locale, model);
  const content = await translateHtml(post.content, locale, model);
  return {
    hash: postHash(post),
    model,
    data: {
      title: title.slice(0, 255),
      description: description.slice(0, 2000),
      seoTitle: post.seoTitle ? seoTitle.slice(0, 255) : null,
      seoDescription: post.seoDescription ? seoDescription.slice(0, 320) : null,
      content,
    },
  };
}

async function translateShop(row: TranslationRow) {
  const p = await prisma.shopProduct.findUnique({
    where: { id: row.entityId },
    select: { title: true, description: true, highlights: true, badge: true },
  });
  if (!p) return null;
  const locale = row.locale as TranslationLocale;
  const model = await activeModel();
  const highlights = stringList(p.highlights);
  const segments = [p.title, p.description || '', p.badge || '', ...highlights];
  const out = await translateSegments(segments, locale, model);
  return {
    hash: shopHash(p),
    model,
    data: {
      title: out[0].slice(0, 255),
      description: p.description ? out[1] : null,
      extra: { badge: p.badge ? out[2].slice(0, 40) : null, highlights: out.slice(3).map(h => h.slice(0, 200)) },
    },
  };
}

/** Recupera itens presos em PROCESSING (worker fechado no meio). */
export async function recoverStaleTranslations() {
  await prisma.contentTranslation.updateMany({
    where: { status: 'PROCESSING', lockedAt: { lt: new Date(Date.now() - 30 * 60_000) } },
    data: { status: 'PENDING', lockedAt: null },
  });
}

/** Processa um item da fila. Devolve false quando não há nada a fazer. */
export async function processNextTranslation(log: (msg: string) => void = () => undefined) {
  const settings = await getAllSettings();
  if (!settings.translation.enabled) return false;
  const next = await prisma.contentTranslation.findFirst({
    where: {
      OR: [
        { status: 'PENDING' },
        { status: 'FAILED', attempts: { lt: 3 }, updatedAt: { lt: new Date(Date.now() - 20 * 60_000) } },
      ],
      locale: { in: settings.translation.locales },
      ...(settings.translation.translateShop ? {} : { entityType: 'post' }),
    },
    // Artigos antes de produtos; mais antigos primeiro.
    orderBy: [{ entityType: 'asc' }, { createdAt: 'asc' }],
  });
  if (!next) return false;
  const lock = await prisma.contentTranslation.updateMany({
    where: { id: next.id, status: next.status, updatedAt: next.updatedAt },
    data: { status: 'PROCESSING', lockedAt: new Date(), attempts: { increment: 1 } },
  });
  if (!lock.count) return true; // outro worker pegou

  const started = Date.now();
  try {
    const result = next.entityType === 'post' ? await translatePost(next) : await translateShop(next);
    if (!result) {
      await prisma.contentTranslation.delete({ where: { id: next.id } }).catch(() => undefined);
      return true;
    }
    await prisma.contentTranslation.update({
      where: { id: next.id },
      data: {
        ...result.data,
        status: 'DONE',
        sourceHash: result.hash,
        model: result.model,
        error: null,
        lockedAt: null,
        manualEdit: false,
        reviewedAt: null,
        translatedAt: new Date(),
      },
    });
    log(`${next.entityType} ${next.entityId} → ${next.locale} em ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = /fetch failed|ECONNREFUSED/i.test(raw)
      ? 'O Ollama não respondeu (está ligado no seu PC?). A tradução será tentada de novo em 20 minutos.'
      : /JSON/i.test(raw)
        ? 'A IA devolveu uma resposta fora do formato. A tradução será tentada de novo; se repetir, use um modelo maior (ex.: qwen3:8b).'
        : raw;
    await prisma.contentTranslation.update({
      where: { id: next.id },
      data: { status: 'FAILED', error: message.slice(0, 2000), lockedAt: null },
    });
    log(`falhou ${next.entityType} ${next.entityId} → ${next.locale}: ${message}`);
  }
  return true;
}

export async function translationStats() {
  const rows = await prisma.contentTranslation.groupBy({ by: ['entityType', 'locale', 'status'], _count: { _all: true } });
  return rows.map(r => ({ entityType: r.entityType, locale: r.locale, status: r.status, count: r._count._all }));
}
