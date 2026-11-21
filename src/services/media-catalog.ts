import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { getCache, setCache } from '../lib/redis.js';
import { slugify } from '../lib/security.js';

export const mediaTypes = ['MOVIE', 'SERIES', 'GAME', 'ANIME', 'MANGA', 'COMIC'] as const;
export type MediaType = (typeof mediaTypes)[number];
export type CatalogProvider = 'TMDB' | 'IGDB' | 'ANILIST';

export type CatalogItem = {
  provider: CatalogProvider;
  externalId: string;
  mediaType: MediaType;
  title: string;
  originalTitle?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  backdropUrl?: string | null;
  releaseDate?: string | null;
  genres: string[];
  rating?: number | null;
  sourceUrl?: string | null;
  trailerUrl?: string | null;
  metadata?: Record<string, unknown>;
};

const compact = (value?: string | null) =>
  value
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
const tmdbImage = (path?: string | null, size = 'w500') => (path ? `https://image.tmdb.org/t/p/${size}${path}` : null);
const igdbImage = (imageId?: string | null, size = 't_cover_big') =>
  imageId ? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg` : null;
const dateFromParts = (year?: number | null, month?: number | null, day?: number | null) =>
  year
    ? `${String(year).padStart(4, '0')}-${String(month || 1).padStart(2, '0')}-${String(day || 1).padStart(2, '0')}`
    : null;

async function requestJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${new URL(url).hostname}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * O TMDB tem 2 tipos de credencial e as duas funcionam aqui:
 * - "Token de leitura da API" (v4, começa com "eyJ...", longo) → cabeçalho Bearer;
 * - "Chave da API" (v3, 32 letras/números) → parâmetro api_key na URL.
 * Antes só o Bearer era aceito, e a chave v3 fazia toda busca voltar vazia (401).
 */
const tmdbCredential = () => (env.TMDB_READ_TOKEN || '').trim();
const tmdbIsV3Key = () => /^[a-f0-9]{32}$/i.test(tmdbCredential());

function tmdbHeaders(): Record<string, string> | null {
  const cred = tmdbCredential();
  if (!cred) return null;
  return tmdbIsV3Key() ? { Accept: 'application/json' } : { Authorization: `Bearer ${cred}`, Accept: 'application/json' };
}

/** Acrescenta api_key quando a credencial é a chave v3. */
function tmdbUrl(url: URL | string) {
  const u = new URL(url.toString());
  if (tmdbIsV3Key()) u.searchParams.set('api_key', tmdbCredential());
  return u.toString();
}

async function searchTmdb(query: string, type: 'MOVIE' | 'SERIES'): Promise<CatalogItem[]> {
  const headers = tmdbHeaders();
  if (!headers) return [];
  const endpoint = type === 'MOVIE' ? 'movie' : 'tv';
  const url = new URL(`https://api.themoviedb.org/3/search/${endpoint}`);
  url.searchParams.set('query', query);
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('language', 'pt-BR');
  url.searchParams.set('page', '1');
  const data = await requestJson<any>(tmdbUrl(url), { headers });
  return (data.results || []).slice(0, 8).map((row: any) => ({
    provider: 'TMDB' as const,
    externalId: String(row.id),
    mediaType: type,
    title: String(type === 'MOVIE' ? row.title : row.name || ''),
    originalTitle: type === 'MOVIE' ? row.original_title : row.original_name,
    description: compact(row.overview),
    coverUrl: tmdbImage(row.poster_path),
    backdropUrl: tmdbImage(row.backdrop_path, 'w780'),
    releaseDate: type === 'MOVIE' ? row.release_date : row.first_air_date,
    genres: [],
    rating: typeof row.vote_average === 'number' ? row.vote_average : null,
    sourceUrl: `https://www.themoviedb.org/${endpoint}/${row.id}`,
    metadata: { popularity: row.popularity, originalLanguage: row.original_language },
  }));
}

async function detailTmdb(id: string, type: 'MOVIE' | 'SERIES'): Promise<CatalogItem | null> {
  const headers = tmdbHeaders();
  if (!headers) return null;
  const endpoint = type === 'MOVIE' ? 'movie' : 'tv';
  const url = new URL(`https://api.themoviedb.org/3/${endpoint}/${encodeURIComponent(id)}`);
  url.searchParams.set('language', 'pt-BR');
  url.searchParams.set('append_to_response', 'videos,credits');
  const row = await requestJson<any>(tmdbUrl(url), { headers });
  const trailer =
    (row.videos?.results || []).find((v: any) => v.site === 'YouTube' && v.type === 'Trailer') ||
    (row.videos?.results || []).find((v: any) => v.site === 'YouTube');
  const cast = (row.credits?.cast || []).slice(0, 8).map((p: any) => ({
    id: p.id,
    name: p.name,
    character: p.character,
    profileUrl: tmdbImage(p.profile_path, 'w185'),
  }));
  const crew = (row.credits?.crew || [])
    .filter((p: any) => ['Director', 'Creator', 'Executive Producer'].includes(p.job))
    .slice(0, 8)
    .map((p: any) => ({ id: p.id, name: p.name, job: p.job }));
  return {
    provider: 'TMDB',
    externalId: String(row.id),
    mediaType: type,
    title: String(type === 'MOVIE' ? row.title : row.name || ''),
    originalTitle: type === 'MOVIE' ? row.original_title : row.original_name,
    description: compact(row.overview),
    coverUrl: tmdbImage(row.poster_path),
    backdropUrl: tmdbImage(row.backdrop_path, 'w1280'),
    releaseDate: type === 'MOVIE' ? row.release_date : row.first_air_date,
    genres: (row.genres || []).map((g: any) => g.name).filter(Boolean),
    rating: typeof row.vote_average === 'number' ? row.vote_average : null,
    sourceUrl: `https://www.themoviedb.org/${endpoint}/${row.id}`,
    trailerUrl: trailer?.key ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    metadata: {
      runtime: row.runtime,
      episodeRunTime: row.episode_run_time,
      numberOfSeasons: row.number_of_seasons,
      numberOfEpisodes: row.number_of_episodes,
      status: row.status,
      tagline: row.tagline,
      cast,
      crew,
      originalLanguage: row.original_language,
    },
  };
}

const ANILIST_QUERY = `query ($search:String!,$type:MediaType!){
  Page(page:1,perPage:8){media(search:$search,type:$type,isAdult:false,sort:SEARCH_MATCH){
    id title{romaji english native} description(asHtml:false) coverImage{extraLarge large} bannerImage
    startDate{year month day} genres averageScore episodes chapters volumes format status siteUrl
    trailer{id site thumbnail}
  }}
}`;
const ANILIST_DETAIL = `query ($id:Int!,$type:MediaType!){Media(id:$id,type:$type){
  id title{romaji english native} description(asHtml:false) coverImage{extraLarge large} bannerImage
  startDate{year month day} endDate{year month day} genres averageScore episodes chapters volumes format status siteUrl
  trailer{id site thumbnail} studios{nodes{name isAnimationStudio}} tags{name rank isMediaSpoiler}
}}`;

function normalizeAniList(row: any, type: 'ANIME' | 'MANGA'): CatalogItem {
  const title = row.title?.english || row.title?.romaji || row.title?.native || `AniList ${row.id}`;
  const trailer =
    row.trailer?.site === 'youtube' && row.trailer?.id ? `https://www.youtube.com/watch?v=${row.trailer.id}` : null;
  return {
    provider: 'ANILIST',
    externalId: String(row.id),
    mediaType: type,
    title,
    originalTitle: row.title?.romaji || row.title?.native || null,
    description: compact(row.description),
    coverUrl: row.coverImage?.extraLarge || row.coverImage?.large || null,
    backdropUrl: row.bannerImage || null,
    releaseDate: dateFromParts(row.startDate?.year, row.startDate?.month, row.startDate?.day),
    genres: (row.genres || []).filter(Boolean),
    rating: typeof row.averageScore === 'number' ? row.averageScore / 10 : null,
    sourceUrl: row.siteUrl || `https://anilist.co/${type === 'ANIME' ? 'anime' : 'manga'}/${row.id}`,
    trailerUrl: trailer,
    metadata: {
      episodes: row.episodes,
      chapters: row.chapters,
      volumes: row.volumes,
      format: row.format,
      status: row.status,
      studios: row.studios?.nodes,
      tags: (row.tags || [])
        .filter((t: any) => !t.isMediaSpoiler && t.rank >= 60)
        .slice(0, 10)
        .map((t: any) => t.name),
      endDate: dateFromParts(row.endDate?.year, row.endDate?.month, row.endDate?.day),
    },
  };
}

async function anilistRequest(query: string, variables: any) {
  return requestJson<any>(
    'https://graphql.anilist.co',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    },
    18000,
  );
}
async function searchAniList(query: string, type: 'ANIME' | 'MANGA'): Promise<CatalogItem[]> {
  const data = await anilistRequest(ANILIST_QUERY, { search: query, type });
  return (data.data?.Page?.media || []).map((row: any) => normalizeAniList(row, type));
}
async function detailAniList(id: string, type: 'ANIME' | 'MANGA'): Promise<CatalogItem | null> {
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) return null;
  const data = await anilistRequest(ANILIST_DETAIL, { id: numeric, type });
  return data.data?.Media ? normalizeAniList(data.data.Media, type) : null;
}

let igdbToken: { value: string; expiresAt: number } | null = null;
async function getIgdbToken() {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return null;
  if (igdbToken && igdbToken.expiresAt > Date.now() + 60_000) return igdbToken.value;
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', env.IGDB_CLIENT_ID);
  url.searchParams.set('client_secret', env.IGDB_CLIENT_SECRET);
  url.searchParams.set('grant_type', 'client_credentials');
  const data = await requestJson<any>(url.toString(), { method: 'POST' }, 15000);
  igdbToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000,
  };
  return igdbToken.value;
}
async function igdbRequest(body: string) {
  const token = await getIgdbToken();
  if (!token) return [];
  return requestJson<any[]>(
    'https://api.igdb.com/v4/games',
    {
      method: 'POST',
      headers: { 'Client-ID': env.IGDB_CLIENT_ID!, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body,
    },
    18000,
  );
}
function normalizeIgdb(row: any): CatalogItem {
  const video = (row.videos || [])[0]?.video_id;
  return {
    provider: 'IGDB',
    externalId: String(row.id),
    mediaType: 'GAME',
    title: row.name || `Game ${row.id}`,
    originalTitle: row.name || null,
    description: compact(row.summary || row.storyline),
    coverUrl: igdbImage(row.cover?.image_id),
    backdropUrl: igdbImage(row.artworks?.[0]?.image_id, 't_1080p'),
    releaseDate: row.first_release_date ? new Date(row.first_release_date * 1000).toISOString().slice(0, 10) : null,
    genres: (row.genres || []).map((g: any) => g.name).filter(Boolean),
    rating: typeof row.rating === 'number' ? row.rating / 10 : null,
    sourceUrl: row.url || `https://www.igdb.com/games/${row.slug || row.id}`,
    trailerUrl: video ? `https://www.youtube.com/watch?v=${video}` : null,
    metadata: {
      platforms: (row.platforms || []).map((p: any) => p.name),
      companies: (row.involved_companies || []).map((c: any) => c.company?.name).filter(Boolean),
      slug: row.slug,
    },
  };
}
async function searchIgdb(query: string): Promise<CatalogItem[]> {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return [];
  const safe = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const rows = await igdbRequest(
    `search "${safe}"; fields name,summary,storyline,slug,url,cover.image_id,first_release_date,genres.name,rating,platforms.name,videos.video_id,artworks.image_id,involved_companies.company.name; limit 8;`,
  );
  return rows.map(normalizeIgdb);
}
async function detailIgdb(id: string): Promise<CatalogItem | null> {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return null;
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) return null;
  const rows = await igdbRequest(
    `fields name,summary,storyline,slug,url,cover.image_id,first_release_date,genres.name,rating,platforms.name,videos.video_id,artworks.image_id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher; where id = ${numeric}; limit 1;`,
  );
  return rows[0] ? normalizeIgdb(rows[0]) : null;
}

export function providerAvailability() {
  return {
    TMDB: Boolean(env.TMDB_READ_TOKEN),
    ANILIST: true,
    IGDB: Boolean(env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET),
  };
}

/** Testa cada fonte do catálogo (usado em /catalog/diagnostics, só para a equipe). */
export async function diagnoseProviders() {
  const run = async (fn: () => Promise<CatalogItem[]>) => {
    const t = Date.now();
    try {
      const items = await fn();
      return { ok: items.length > 0, results: items.length, ms: Date.now() - t, error: items.length ? null : 'Sem resultados' };
    } catch (e) {
      return { ok: false, results: 0, ms: Date.now() - t, error: e instanceof Error ? e.message : String(e) };
    }
  };
  return {
    TMDB: env.TMDB_READ_TOKEN
      ? { ...(await run(() => searchTmdb('Batman', 'MOVIE'))), credential: tmdbIsV3Key() ? 'chave v3 (api_key)' : 'token v4 (Bearer)' }
      : { ok: false, error: 'TMDB_READ_TOKEN não configurado' },
    ANILIST: await run(() => searchAniList('Naruto', 'ANIME')),
    IGDB:
      env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET
        ? await run(() => searchIgdb('Zelda'))
        : { ok: false, error: 'IGDB_CLIENT_ID / IGDB_CLIENT_SECRET não configurados (jogos)' },
  };
}

export async function searchCatalog(query: string, type?: MediaType) {
  const normalized = query.trim();
  const cacheKey = `catalog:search:${type || 'ALL'}:${normalized.toLowerCase()}`;
  const cached = await getCache<CatalogItem[]>(cacheKey);
  if (cached) return cached;
  const localRows = await prisma.mediaCatalogItem
    .findMany({
      where: { title: { contains: normalized }, ...(type ? { mediaType: type } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    })
    .catch(() => []);
  const localItems: CatalogItem[] = localRows.map((row: any) => ({
    provider: row.provider as CatalogProvider,
    externalId: row.externalId,
    mediaType: row.mediaType as MediaType,
    title: row.title,
    originalTitle: row.originalTitle,
    description: row.description,
    coverUrl: row.coverUrl,
    backdropUrl: row.backdropUrl,
    releaseDate: row.releaseDate ? row.releaseDate.toISOString().slice(0, 10) : null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    rating: row.rating,
    sourceUrl: row.sourceUrl,
    trailerUrl: row.trailerUrl,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  }));
  const tasks: Promise<CatalogItem[]>[] = [];
  if ((!type || type === 'MOVIE') && env.TMDB_READ_TOKEN) tasks.push(searchTmdb(normalized, 'MOVIE'));
  if ((!type || type === 'SERIES') && env.TMDB_READ_TOKEN) tasks.push(searchTmdb(normalized, 'SERIES'));
  if (!type || type === 'ANIME') tasks.push(searchAniList(normalized, 'ANIME'));
  if (!type || type === 'MANGA') tasks.push(searchAniList(normalized, 'MANGA'));
  if ((!type || type === 'GAME') && env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET) tasks.push(searchIgdb(normalized));
  // HQ/COMIC fica manual nesta primeira fase até adicionarmos um provider dedicado.
  const settled = await Promise.allSettled(tasks);
  const failures = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  for (const f of failures) console.warn('[catalogo] busca externa falhou:', f.reason instanceof Error ? f.reason.message : f.reason);
  const external = settled.flatMap(r => (r.status === 'fulfilled' ? r.value : [])).filter(i => i.title);
  const seen = new Set<string>();
  const items = [...localItems, ...external]
    .filter(item => {
      const key = `${item.provider}:${item.mediaType}:${item.externalId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 24);
  // Não guarda "nada encontrado" quando foi falha de rede/credencial (tenta de novo na próxima busca).
  if (items.length || !failures.length) await setCache(cacheKey, items, items.length ? 600 : 120);
  return items;
}

export async function getCatalogDetails(
  provider: CatalogProvider,
  type: MediaType,
  externalId: string,
): Promise<CatalogItem | null> {
  const cacheKey = `catalog:detail:${provider}:${type}:${externalId}`;
  const cached = await getCache<CatalogItem>(cacheKey);
  if (cached) return cached;
  const local = await prisma.mediaCatalogItem
    .findUnique({ where: { provider_externalId_mediaType: { provider, externalId, mediaType: type } } })
    .catch(() => null);
  if (local) {
    const localItem: CatalogItem = {
      provider: local.provider as CatalogProvider,
      externalId: local.externalId,
      mediaType: local.mediaType as MediaType,
      title: local.title,
      originalTitle: local.originalTitle,
      description: local.description,
      coverUrl: local.coverUrl,
      backdropUrl: local.backdropUrl,
      releaseDate: local.releaseDate ? local.releaseDate.toISOString().slice(0, 10) : null,
      genres: Array.isArray(local.genres) ? (local.genres as string[]) : [],
      rating: local.rating,
      sourceUrl: local.sourceUrl,
      trailerUrl: local.trailerUrl,
      metadata: local.metadata && typeof local.metadata === 'object' ? (local.metadata as Record<string, unknown>) : {},
    };
    await setCache(cacheKey, localItem, env.MEDIA_CATALOG_CACHE_HOURS * 3600);
    return localItem;
  }
  let item: CatalogItem | null = null;
  if (provider === 'TMDB' && (type === 'MOVIE' || type === 'SERIES')) item = await detailTmdb(externalId, type);
  else if (provider === 'ANILIST' && (type === 'ANIME' || type === 'MANGA'))
    item = await detailAniList(externalId, type);
  else if (provider === 'IGDB' && type === 'GAME') item = await detailIgdb(externalId);
  if (item) await setCache(cacheKey, item, env.MEDIA_CATALOG_CACHE_HOURS * 3600);
  return item;
}

export async function cacheCatalogItem(item: CatalogItem) {
  const releaseDate =
    item.releaseDate && /^\d{4}-\d{2}-\d{2}/.test(item.releaseDate)
      ? new Date(`${item.releaseDate.slice(0, 10)}T00:00:00.000Z`)
      : null;
  return prisma.mediaCatalogItem.upsert({
    where: {
      provider_externalId_mediaType: {
        provider: item.provider,
        externalId: item.externalId,
        mediaType: item.mediaType,
      },
    },
    update: {
      title: item.title,
      originalTitle: item.originalTitle || null,
      slug: slugify(item.title),
      description: item.description || null,
      coverUrl: item.coverUrl || null,
      backdropUrl: item.backdropUrl || null,
      releaseDate,
      genres: item.genres,
      sourceUrl: item.sourceUrl || null,
      trailerUrl: item.trailerUrl || null,
      rating: item.rating ?? null,
      metadata: (item.metadata || {}) as any,
    },
    create: {
      provider: item.provider,
      externalId: item.externalId,
      mediaType: item.mediaType,
      title: item.title,
      originalTitle: item.originalTitle || null,
      slug: slugify(item.title),
      description: item.description || null,
      coverUrl: item.coverUrl || null,
      backdropUrl: item.backdropUrl || null,
      releaseDate,
      genres: item.genres,
      sourceUrl: item.sourceUrl || null,
      trailerUrl: item.trailerUrl || null,
      rating: item.rating ?? null,
      metadata: (item.metadata || {}) as any,
    },
  });
}

const ANILIST_RELEASES = `query ($type:MediaType!,$from:FuzzyDateInt!,$to:FuzzyDateInt!){
  Page(page:1,perPage:30){media(type:$type,isAdult:false,startDate_greater:$from,startDate_lesser:$to,sort:[START_DATE]){
    id title{romaji english native} description(asHtml:false) coverImage{extraLarge large} bannerImage
    startDate{year month day} genres averageScore episodes chapters volumes format status siteUrl trailer{id site thumbnail}
  }}
}`;

function dateOnly(value: string) {
  const match = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!match) throw new Error('Data inválida');
  return value;
}
function utcDate(value: string) {
  return new Date(`${dateOnly(value)}T00:00:00.000Z`);
}
function fuzzyDate(value: string, offsetDays = 0) {
  const d = utcDate(value);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return Number(
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`,
  );
}

async function releasesTmdb(from: string, to: string, type: 'MOVIE' | 'SERIES'): Promise<CatalogItem[]> {
  const headers = tmdbHeaders();
  if (!headers) return [];
  const endpoint = type === 'MOVIE' ? 'movie' : 'tv';
  const url = new URL(`https://api.themoviedb.org/3/discover/${endpoint}`);
  url.searchParams.set('language', 'pt-BR');
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('page', '1');
  url.searchParams.set('sort_by', type === 'MOVIE' ? 'primary_release_date.asc' : 'first_air_date.asc');
  url.searchParams.set(type === 'MOVIE' ? 'primary_release_date.gte' : 'first_air_date.gte', from);
  url.searchParams.set(type === 'MOVIE' ? 'primary_release_date.lte' : 'first_air_date.lte', to);
  const data = await requestJson<any>(tmdbUrl(url), { headers }, 18000);
  return (data.results || [])
    .slice(0, 30)
    .map((row: any) => ({
      provider: 'TMDB' as const,
      externalId: String(row.id),
      mediaType: type,
      title: String(type === 'MOVIE' ? row.title : row.name || ''),
      originalTitle: type === 'MOVIE' ? row.original_title : row.original_name,
      description: compact(row.overview),
      coverUrl: tmdbImage(row.poster_path),
      backdropUrl: tmdbImage(row.backdrop_path, 'w780'),
      releaseDate: type === 'MOVIE' ? row.release_date : row.first_air_date,
      genres: [],
      rating: typeof row.vote_average === 'number' ? row.vote_average : null,
      sourceUrl: `https://www.themoviedb.org/${endpoint}/${row.id}`,
      metadata: { popularity: row.popularity, originalLanguage: row.original_language },
    }))
    .filter((x: any) => x.releaseDate);
}

async function releasesAniList(from: string, to: string, type: 'ANIME' | 'MANGA'): Promise<CatalogItem[]> {
  // greater/lesser são exclusivos no AniList; ampliamos um dia em cada ponta e filtramos localmente.
  const data = await anilistRequest(ANILIST_RELEASES, { type, from: fuzzyDate(from, -1), to: fuzzyDate(to, 1) });
  return (data.data?.Page?.media || [])
    .map((row: any) => normalizeAniList(row, type))
    .filter((item: CatalogItem) => Boolean(item.releaseDate && item.releaseDate >= from && item.releaseDate <= to));
}

async function releasesIgdb(from: string, to: string): Promise<CatalogItem[]> {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return [];
  const fromUnix = Math.floor(utcDate(from).getTime() / 1000);
  const toDate = utcDate(to);
  toDate.setUTCHours(23, 59, 59, 999);
  const toUnix = Math.floor(toDate.getTime() / 1000);
  const rows = await igdbRequest(
    `fields name,summary,storyline,slug,url,cover.image_id,first_release_date,genres.name,rating,platforms.name,videos.video_id,artworks.image_id,involved_companies.company.name; where first_release_date >= ${fromUnix} & first_release_date <= ${toUnix}; sort first_release_date asc; limit 30;`,
  );
  return rows.map(normalizeIgdb).filter(item => Boolean(item.releaseDate));
}

export async function getCatalogReleases(from: string, to: string, type?: MediaType) {
  dateOnly(from);
  dateOnly(to);
  if (from > to) throw new Error('Intervalo de datas inválido');
  const cacheKey = `catalog:releases:${type || 'ALL'}:${from}:${to}`;
  const cached = await getCache<CatalogItem[]>(cacheKey);
  if (cached) return cached;
  const local = await prisma.mediaCatalogItem
    .findMany({
      where: {
        releaseDate: { gte: utcDate(from), lte: new Date(`${to}T23:59:59.999Z`) },
        ...(type ? { mediaType: type } : {}),
      },
      orderBy: { releaseDate: 'asc' },
      take: 100,
    })
    .catch(() => []);
  const localItems: CatalogItem[] = local.map((row: any) => ({
    provider: row.provider as CatalogProvider,
    externalId: row.externalId,
    mediaType: row.mediaType as MediaType,
    title: row.title,
    originalTitle: row.originalTitle,
    description: row.description,
    coverUrl: row.coverUrl,
    backdropUrl: row.backdropUrl,
    releaseDate: row.releaseDate ? row.releaseDate.toISOString().slice(0, 10) : null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    rating: row.rating,
    sourceUrl: row.sourceUrl,
    trailerUrl: row.trailerUrl,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  }));
  const tasks: Promise<CatalogItem[]>[] = [];
  if ((!type || type === 'MOVIE') && env.TMDB_READ_TOKEN) tasks.push(releasesTmdb(from, to, 'MOVIE'));
  if ((!type || type === 'SERIES') && env.TMDB_READ_TOKEN) tasks.push(releasesTmdb(from, to, 'SERIES'));
  if (!type || type === 'ANIME') tasks.push(releasesAniList(from, to, 'ANIME'));
  if (!type || type === 'MANGA') tasks.push(releasesAniList(from, to, 'MANGA'));
  if ((!type || type === 'GAME') && env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET) tasks.push(releasesIgdb(from, to));
  const settled = await Promise.allSettled(tasks);
  const external = settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
  const seen = new Set<string>();
  const items = [...localItems, ...external]
    .filter(item => {
      if (!item.releaseDate || item.releaseDate < from || item.releaseDate > to) return false;
      const key = `${item.provider}:${item.mediaType}:${item.externalId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999'))
    .slice(0, 120);
  await setCache(cacheKey, items, 1800);
  return items;
}

// ---- Onde assistir (TMDB watch providers, dados da JustWatch) ----
export type WatchProvider = { id: number; name: string; logoUrl: string | null };
export type WatchProviders = {
  region: string;
  link: string | null;
  flatrate: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
  free: WatchProvider[];
  ads: WatchProvider[];
};

export async function getWatchProviders(
  provider: CatalogProvider,
  type: MediaType,
  externalId: string,
  region = env.WATCH_PROVIDERS_REGION,
): Promise<WatchProviders | null> {
  if (provider !== 'TMDB' || (type !== 'MOVIE' && type !== 'SERIES') || !/^\d{1,12}$/.test(externalId)) return null;
  const headers = tmdbHeaders();
  if (!headers) return null;
  const cacheKey = `catalog:watch:${type}:${externalId}:${region}`;
  const cached = await getCache<WatchProviders>(cacheKey);
  if (cached) return cached;
  const endpoint = type === 'MOVIE' ? 'movie' : 'tv';
  try {
    const data = await requestJson<any>(
      tmdbUrl(`https://api.themoviedb.org/3/${endpoint}/${encodeURIComponent(externalId)}/watch/providers`),
      { headers },
    );
    const r = data?.results?.[region] || {};
    const map = (list: any[] | undefined): WatchProvider[] =>
      (list || [])
        .sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))
        .map(p => ({
          id: Number(p.provider_id),
          name: String(p.provider_name),
          logoUrl: tmdbImage(p.logo_path, 'w92'),
        }));
    const result: WatchProviders = {
      region,
      link: typeof r.link === 'string' ? r.link : null,
      flatrate: map(r.flatrate),
      rent: map(r.rent),
      buy: map(r.buy),
      free: map(r.free),
      ads: map(r.ads),
    };
    await setCache(cacheKey, result, 12 * 3600);
    return result;
  } catch {
    return null;
  }
}
