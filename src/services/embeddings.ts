import { createHash } from 'node:crypto';
import { prisma } from '../db.js';
import { env } from '../config/env.js';

const VECTOR_DIMENSIONS = 1024;

function textFromHtml(html: string) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function documentText(post: {
  title: string;
  description: string;
  content: string;
  category: { name: string };
  tags: Array<{ tag: { name: string } }>;
}) {
  const tags = post.tags.map(t => t.tag.name).join(', ');
  return `Título: ${post.title}\nCategoria: ${post.category.name}\nTags: ${tags}\nResumo: ${post.description}\nConteúdo: ${textFromHtml(post.content).slice(0, 14_000)}`;
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function ollama(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.EMBEDDING_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.OLLAMA_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) throw new Error(data?.error || `Ollama respondeu HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function embeddingModelStatus() {
  try {
    const tags = await ollama('/api/tags', { method: 'GET' });
    const names = (tags.models || []).map((m: any) => String(m.name || m.model || ''));
    const installed = names.some(
      (name: string) => name === env.EMBEDDING_MODEL || name.startsWith(`${env.EMBEDDING_MODEL}:`),
    );
    return { ok: true, installed, model: env.EMBEDDING_MODEL };
  } catch (error) {
    return {
      ok: false,
      installed: false,
      model: env.EMBEDDING_MODEL,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ensureEmbeddingModel() {
  const status = await embeddingModelStatus();
  if (!status.ok) throw new Error(status.error || 'Ollama indisponível');
  if (status.installed) return status;
  if (env.EMBEDDING_AUTO_PULL !== 'true') throw new Error(`Modelo ${env.EMBEDDING_MODEL} não instalado`);
  await ollama('/api/pull', { method: 'POST', body: JSON.stringify({ model: env.EMBEDDING_MODEL, stream: false }) });
  return { ok: true, installed: true, model: env.EMBEDDING_MODEL };
}

export async function embedText(input: string) {
  const data = await ollama('/api/embed', {
    method: 'POST',
    body: JSON.stringify({ model: env.EMBEDDING_MODEL, input, keep_alive: '2m' }),
  });
  const vector = data.embeddings?.[0];
  if (!Array.isArray(vector) || vector.length !== VECTOR_DIMENSIONS) {
    throw new Error(
      `Embedding inválido: esperado ${VECTOR_DIMENSIONS} dimensões, recebido ${Array.isArray(vector) ? vector.length : 0}`,
    );
  }
  if (vector.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v)))
    throw new Error('Embedding contém valores inválidos');
  return vector as number[];
}

export async function ensureVectorInfrastructure() {
  // MySQL não tem pgvector: os vetores ficam em JSON e a similaridade é calculada
  // na API (rápido para alguns milhares de artigos). Nada a preparar no banco.
}

function toVector(value: unknown): number[] | null {
  const arr = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(arr) || !arr.length) return null;
  const out = arr.map(Number);
  return out.every(Number.isFinite) ? out : null;
}

function normalize(v: number[]) {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1;
  return v.map(x => x / norm);
}

function dot(a: number[], b: number[]) {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += a[i] * b[i];
  return sum;
}

export async function syncPostEmbeddings(limit = env.EMBEDDING_BATCH_SIZE) {
  const now = new Date();
  // Posts publicados sem embedding, com modelo diferente ou atualizados depois do embedding.
  const candidates = await prisma.post.findMany({
    where: { status: 'PUBLISHED', publishedAt: { not: null, lte: now } },
    select: { id: true, updatedAt: true, embedding: { select: { model: true, updatedAt: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 2000,
  });
  const pendingIds = candidates
    .filter(p => !p.embedding || p.embedding.model !== env.EMBEDDING_MODEL || p.embedding.updatedAt < p.updatedAt)
    .map(p => p.id);
  const ids = pendingIds.slice(0, Math.max(1, limit));
  if (!ids.length) return { indexed: 0, pending: 0, model: env.EMBEDDING_MODEL };

  const posts = await prisma.post.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      description: true,
      content: true,
      category: { select: { name: true } },
      tags: { select: { tag: { select: { name: true } } } },
    },
  });
  const byId = new Map(posts.map(post => [post.id, post]));

  let indexed = 0;
  for (const id of ids) {
    const post = byId.get(id);
    if (!post) continue;
    const text = documentText(post);
    const hash = hashText(text);
    const embedding =
      await embedText(`Represent this Hypeverso geek-news document for semantic recommendation and retrieval in Portuguese.
${text}`);
    // Guardamos o vetor já normalizado: a similaridade de cosseno vira um produto escalar.
    const vector = normalize(embedding).map(x => Number(x.toFixed(6)));
    await prisma.postEmbedding.upsert({
      where: { postId: post.id },
      create: { postId: post.id, model: env.EMBEDDING_MODEL, contentHash: hash, embedding: vector },
      update: { model: env.EMBEDDING_MODEL, contentHash: hash, embedding: vector },
    });
    indexed++;
  }
  return { indexed, pending: Math.max(0, pendingIds.length - indexed), model: env.EMBEDDING_MODEL };
}

// Cache em memória dos vetores (recarregado a cada 10 min) para não ler o JSON toda hora.
let vectorCache: { at: number; rows: { id: string; v: number[] }[] } | null = null;
async function publishedVectors() {
  if (vectorCache && Date.now() - vectorCache.at < 10 * 60_000) return vectorCache.rows;
  const rows = await prisma.postEmbedding.findMany({
    where: { model: env.EMBEDDING_MODEL, post: { status: 'PUBLISHED', publishedAt: { lte: new Date() } } },
    select: { postId: true, embedding: true },
    orderBy: { updatedAt: 'desc' },
    take: 5000,
  });
  const parsed = rows
    .map(r => ({ id: r.postId, v: toVector(r.embedding) }))
    .filter((r): r is { id: string; v: number[] } => Boolean(r.v));
  vectorCache = { at: Date.now(), rows: parsed };
  return parsed;
}

export async function semanticCandidates(userId: string, limit = 30) {
  try {
    const since120 = new Date(Date.now() - 120 * 86400000);
    const since30 = new Date(Date.now() - 30 * 86400000);
    const [favs, interactions] = await Promise.all([
      prisma.favorite.findMany({ where: { userId }, select: { postId: true }, take: 500 }),
      prisma.userInteraction.findMany({
        where: { userId, createdAt: { gte: since120 } },
        select: { postId: true, type: true, createdAt: true },
        take: 1000,
      }),
    ]);
    const signal = new Set([...favs.map(f => f.postId), ...interactions.map(i => i.postId)]);
    if (!signal.size) return [];
    const exclude = new Set([
      ...favs.map(f => f.postId),
      ...interactions.filter(i => i.type === 'VIEW' && i.createdAt >= since30).map(i => i.postId),
    ]);

    const vectors = await publishedVectors();
    const signalVectors = vectors.filter(r => signal.has(r.id)).map(r => r.v);
    if (!signalVectors.length) return [];
    // Perfil do usuário = média dos vetores do que ele curtiu/leu.
    const dims = signalVectors[0].length;
    const profile = new Array(dims).fill(0);
    for (const v of signalVectors) for (let i = 0; i < dims; i++) profile[i] += v[i] / signalVectors.length;
    const unit = normalize(profile);

    return vectors
      .filter(r => !exclude.has(r.id))
      .map(r => ({ id: r.id, similarity: dot(unit, r.v) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  } catch {
    return [];
  }
}
