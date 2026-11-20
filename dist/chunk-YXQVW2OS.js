import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  db_exports,
  env,
  meiliConfigured,
  prisma
} from "./chunk-AFZENULZ.js";

// src/services/search-index.ts
var INDEX_UID = "posts";
var configuredAt = 0;
function headers(json = true) {
  const h = {};
  if (json) h["content-type"] = "application/json";
  if (env.MEILI_MASTER_KEY) h.authorization = `Bearer ${env.MEILI_MASTER_KEY}`;
  return h;
}
async function meili(path, init = {}) {
  if (!meiliConfigured) {
    const error = new Error("Meilisearch desativado (MEILISEARCH_URL vazio)");
    error.code = "MEILI_DISABLED";
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.MEILI_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.MEILISEARCH_URL}${path}`, {
      ...init,
      headers: { ...headers(init.body !== void 0), ...init.headers },
      signal: controller.signal
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : void 0;
    if (!response.ok) {
      const error = new Error(data?.message || `Meilisearch respondeu HTTP ${response.status}`);
      error.statusCode = response.status;
      error.code = data?.code || "MEILI_ERROR";
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
async function waitTask(taskUid, timeoutMs = 3e4) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const task = await meili(`/tasks/${taskUid}`, { method: "GET" });
    if (task.status === "succeeded") return task;
    if (task.status === "failed" || task.status === "canceled")
      throw new Error(task.error?.message || `Task ${taskUid} falhou`);
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error(`Timeout aguardando task ${taskUid} do Meilisearch`);
}
async function searchIndexHealth() {
  try {
    const health = await meili("/health", { method: "GET" });
    let documents = 0;
    try {
      const stats = await meili(`/indexes/${INDEX_UID}/stats`, { method: "GET" });
      documents = Number(stats.numberOfDocuments || 0);
    } catch {
    }
    return { ok: health.status === "available", status: health.status, documents };
  } catch (error) {
    return {
      ok: false,
      status: "unavailable",
      documents: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
async function ensureSearchIndex() {
  const health = await searchIndexHealth();
  if (!health.ok) throw new Error(health.error || "Meilisearch indispon\xEDvel");
  let exists = true;
  try {
    await meili(`/indexes/${INDEX_UID}`, { method: "GET" });
  } catch (error) {
    if (error?.statusCode === 404) exists = false;
    else throw error;
  }
  if (!exists) {
    const task = await meili("/indexes", {
      method: "POST",
      body: JSON.stringify({ uid: INDEX_UID, primaryKey: "id" })
    });
    await waitTask(task.taskUid);
  }
  if (exists && Date.now() - configuredAt < 5 * 6e4) return;
  const settingsTask = await meili(`/indexes/${INDEX_UID}/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      searchableAttributes: [
        "title",
        "description",
        "categoryName",
        "tagNames",
        "authorName",
        "authorUsername",
        "contentText"
      ],
      displayedAttributes: [
        "id",
        "title",
        "slug",
        "description",
        "coverImageUrl",
        "categoryId",
        "categoryName",
        "categorySlug",
        "tagNames",
        "tagSlugs",
        "authorName",
        "authorUsername",
        "isPremium",
        "publishedAt",
        "publishedAtTs"
      ],
      filterableAttributes: ["categoryId", "categorySlug", "tagSlugs", "isPremium", "publishedAtTs"],
      sortableAttributes: ["publishedAtTs", "createdAtTs", "title"],
      rankingRules: ["words", "typo", "proximity", "attribute", "sort", "exactness"],
      typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
      pagination: { maxTotalHits: 2e3 }
    })
  });
  await waitTask(settingsTask.taskUid);
  configuredAt = Date.now();
}
function plainText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 12e3);
}
async function postDocuments(ids) {
  const now = /* @__PURE__ */ new Date();
  const rows = await prisma.post.findMany({
    where: {
      ...ids ? { id: { in: ids } } : {},
      status: "PUBLISHED",
      publishedAt: { lte: now }
    },
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      content: true,
      coverImageUrl: true,
      isPremium: true,
      publishedAt: true,
      createdAt: true,
      category: { select: { id: true, name: true, slug: true } },
      author: { select: { name: true, username: true } },
      tags: { select: { tag: { select: { name: true, slug: true } } } }
    }
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    coverImageUrl: row.coverImageUrl,
    categoryId: row.category.id,
    categoryName: row.category.name,
    categorySlug: row.category.slug,
    tagNames: row.tags.map((t) => t.tag.name),
    tagSlugs: row.tags.map((t) => t.tag.slug),
    authorName: row.author.name,
    authorUsername: row.author.username,
    isPremium: row.isPremium,
    publishedAt: row.publishedAt?.toISOString() || null,
    publishedAtTs: row.publishedAt?.getTime() || 0,
    createdAtTs: row.createdAt.getTime(),
    contentText: row.isPremium ? "" : plainText(row.content)
  }));
}
async function rebuildSearchIndex() {
  await ensureSearchIndex();
  const clear = await meili(`/indexes/${INDEX_UID}/documents`, { method: "DELETE" });
  await waitTask(clear.taskUid, 6e4);
  const docs = await postDocuments();
  if (!docs.length) return { indexed: 0 };
  for (let i = 0; i < docs.length; i += 500) {
    const task = await meili(`/indexes/${INDEX_UID}/documents?primaryKey=id`, {
      method: "POST",
      body: JSON.stringify(docs.slice(i, i + 500))
    });
    await waitTask(task.taskUid, 6e4);
  }
  return { indexed: docs.length };
}
async function syncPostToSearchIndex(postId) {
  await ensureSearchIndex();
  const docs = await postDocuments([postId]);
  if (!docs.length) {
    try {
      const task2 = await meili(`/indexes/${INDEX_UID}/documents/${encodeURIComponent(postId)}`, {
        method: "DELETE"
      });
      await waitTask(task2.taskUid);
    } catch (error) {
      if (error?.statusCode !== 404) throw error;
    }
    return { indexed: false };
  }
  const task = await meili(`/indexes/${INDEX_UID}/documents?primaryKey=id`, {
    method: "POST",
    body: JSON.stringify(docs)
  });
  await waitTask(task.taskUid);
  return { indexed: true };
}
async function removePostFromSearchIndex(postId) {
  try {
    const task = await meili(`/indexes/${INDEX_UID}/documents/${encodeURIComponent(postId)}`, {
      method: "DELETE"
    });
    await waitTask(task.taskUid);
  } catch (error) {
    if (error?.statusCode !== 404) throw error;
  }
}
async function searchPostsWithMeili(input) {
  const page = Math.max(1, input.page || 1);
  const limit = Math.min(50, Math.max(1, input.limit || 20));
  const filters = [];
  if (input.category) filters.push(`categorySlug = ${JSON.stringify(input.category)}`);
  if (input.tag) filters.push(`tagSlugs = ${JSON.stringify(input.tag)}`);
  if (input.premium !== void 0) filters.push(`isPremium = ${input.premium}`);
  if (input.from) filters.push(`publishedAtTs >= ${input.from.getTime()}`);
  if (input.to) filters.push(`publishedAtTs <= ${input.to.getTime()}`);
  const sort = input.sort === "recent" ? ["publishedAtTs:desc"] : input.sort === "oldest" ? ["publishedAtTs:asc"] : input.sort === "title" ? ["title:asc"] : void 0;
  const result = await meili(`/indexes/${INDEX_UID}/search`, {
    method: "POST",
    body: JSON.stringify({
      q: input.q,
      offset: (page - 1) * limit,
      limit,
      filter: filters.length ? filters : void 0,
      sort,
      facets: ["categorySlug", "tagSlugs"],
      attributesToHighlight: ["title", "description"],
      highlightPreTag: "<mark>",
      highlightPostTag: "</mark>",
      showRankingScore: true
    })
  });
  return {
    posts: (result.hits || []).map((hit) => ({
      id: hit.id,
      title: hit.title,
      slug: hit.slug,
      description: hit.description,
      coverImageUrl: hit.coverImageUrl,
      isPremium: hit.isPremium,
      publishedAt: hit.publishedAt,
      category: { id: hit.categoryId, name: hit.categoryName, slug: hit.categorySlug },
      tags: (hit.tagNames || []).map((name, i) => ({ name, slug: hit.tagSlugs?.[i] || "" })),
      author: { name: hit.authorName, username: hit.authorUsername },
      rankingScore: hit._rankingScore,
      formatted: hit._formatted
    })),
    total: Number(result.estimatedTotalHits || 0),
    page,
    pages: Math.ceil(Number(result.estimatedTotalHits || 0) / limit),
    facets: result.facetDistribution || {},
    engine: "meilisearch"
  };
}

export {
  searchIndexHealth,
  rebuildSearchIndex,
  syncPostToSearchIndex,
  removePostFromSearchIndex,
  searchPostsWithMeili
};
//# sourceMappingURL=chunk-YXQVW2OS.js.map