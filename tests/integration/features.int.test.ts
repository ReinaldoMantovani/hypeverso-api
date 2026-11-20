import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CookieJar, startHarness, type Harness } from './setup.js';

let h: Harness;
let catalogItemId: string;
beforeAll(async () => {
  h = await startHarness();
  const item = await h.prisma.mediaCatalogItem.create({
    data: { provider: 'TMDB', externalId: '603', mediaType: 'MOVIE', title: 'Matrix', slug: 'matrix' },
  });
  catalogItemId = item.id;
});
afterAll(async () => {
  await h?.stop();
});

async function verifiedUser(n: string, extra: Record<string, unknown> = {}) {
  const jar = new CookieJar(h.app);
  await jar.request('POST', '/api/auth/register', {
    name: `User ${n}`,
    username: `user_${n}`,
    email: `user_${n}@example.com`,
    password: 'senha-super-forte-123',
    acceptTerms: true,
  });
  await h.prisma.user.update({
    where: { email: `user_${n}@example.com` },
    data: { emailVerifiedAt: new Date(), ...extra },
  });
  return jar;
}

describe('reviews do catálogo', () => {
  it('calcula média e distribuição e permite uma avaliação por pessoa', async () => {
    const a = await verifiedUser('r1');
    const b = await verifiedUser('r2');
    expect(
      (await a.request('PUT', `/api/catalog/items/${catalogItemId}/reviews`, { rating: 10, body: 'Clássico' }))
        .statusCode,
    ).toBe(200);
    expect((await a.request('PUT', `/api/catalog/items/${catalogItemId}/reviews`, { rating: 9 })).statusCode).toBe(200);
    expect(
      (await b.request('PUT', `/api/catalog/items/${catalogItemId}/reviews`, { rating: 7, spoiler: true })).statusCode,
    ).toBe(200);
    const res = await a.request('GET', `/api/catalog/items/${catalogItemId}/reviews`);
    const data = res.json();
    expect(data.summary.count).toBe(2);
    expect(data.summary.average).toBe(8);
    expect(data.summary.distribution['9']).toBe(1);
    expect(data.viewerReview.rating).toBe(9);
    expect((await a.request('PUT', `/api/catalog/items/${catalogItemId}/reviews`, { rating: 11 })).statusCode).toBe(
      400,
    );
  });
});

describe('listas públicas', () => {
  it('cria, adiciona item, reordena e esconde listas privadas', async () => {
    const owner = await verifiedUser('l1');
    const list = (await owner.request('POST', '/api/lists', { title: 'Top 10 filmes de 1999', isPublic: true })).json();
    expect(list.slug).toBe('top-10-filmes-de-1999');
    const added = await owner.request('POST', `/api/lists/${list.id}/items`, { catalogItemId, note: 'Obrigatório' });
    expect(added.statusCode).toBe(201);
    const pub = await h.app.inject({ method: 'GET', url: `/api/lists/${list.id}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().items).toHaveLength(1);
    await owner.request('PATCH', `/api/lists/${list.id}`, { isPublic: false });
    expect((await h.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })).statusCode).toBe(404);
    expect((await owner.request('GET', `/api/lists/${list.id}`)).statusCode).toBe(200);
    const intruder = await verifiedUser('l2');
    expect((await intruder.request('DELETE', `/api/lists/${list.id}`)).statusCode).toBe(403);
  });
});

describe('threads e watch parties', () => {
  it('cria thread, envia mensagens com spoiler e faz polling incremental', async () => {
    const u = await verifiedUser('t1');
    const past = await u.request('POST', '/api/threads', {
      catalogItemId,
      kind: 'WATCH_PARTY',
      title: 'Maratona',
      startsAt: '2001-01-01T00:00:00.000Z',
    });
    expect(past.statusCode).toBe(400);
    const thread = (
      await u.request('POST', '/api/threads', { catalogItemId, kind: 'GENERAL', title: 'Teorias sobre o final' })
    ).json();
    const m1 = (
      await u.request('POST', `/api/threads/${thread.id}/messages`, {
        content: 'O ||Neo|| é o escolhido',
        spoiler: false,
      })
    ).json();
    const all = (await h.app.inject({ method: 'GET', url: `/api/threads/${thread.id}/messages` })).json();
    expect(all).toHaveLength(1);
    await u.request('POST', `/api/threads/${thread.id}/messages`, { content: 'Spoiler total', spoiler: true });
    const newer = (
      await h.app.inject({
        method: 'GET',
        url: `/api/threads/${thread.id}/messages?after=${encodeURIComponent(m1.createdAt)}`,
      })
    ).json();
    expect(newer).toHaveLength(1);
    expect(newer[0].spoiler).toBe(true);
  });
});

describe('newsletter (double opt-in)', () => {
  it('fica pendente até confirmar e cancela por token', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/newsletter/subscribe',
      payload: { email: 'leitor@example.com', consent: true },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('pending');
    const sub = await h.prisma.newsletterSubscription.findUnique({ where: { email: 'leitor@example.com' } });
    expect(sub.status).toBe('PENDING');
    const unsub = await h.app.inject({
      method: 'POST',
      url: `/api/newsletter/unsubscribe?token=${sub.unsubscribeToken}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });
    expect(unsub.statusCode).toBe(200);
    expect((await h.prisma.newsletterSubscription.findUnique({ where: { email: 'leitor@example.com' } })).status).toBe(
      'UNSUBSCRIBED',
    );
  });
});

describe('triagem comunitária com reputação', () => {
  it('oculta comentário após votos suficientes e recalibra reputação na decisão da equipe', async () => {
    const author = await verifiedUser('c1');
    const reporter = await verifiedUser('c2');
    const category = await h.prisma.category.create({ data: { name: 'Cinema', slug: 'cinema' } });
    const authorRow = await h.prisma.user.findUnique({ where: { email: 'user_c1@example.com' } });
    const post = await h.prisma.post.create({
      data: {
        title: 'Post',
        slug: 'post-triagem',
        description: 'descrição longa',
        content: '<p>conteúdo</p>',
        categoryId: category.id,
        authorId: authorRow.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    const comment = (
      await author.request('POST', `/api/posts/${post.id}/comments`, { content: 'comentário ofensivo' })
    ).json();
    await reporter.request('POST', `/api/comments/${comment.id}/report`, { reason: 'Ofensa' });
    const old = new Date(Date.now() - 60 * 86400000);
    const voters = await Promise.all(
      ['v1', 'v2'].map(n => verifiedUser(n, { level: 10, createdAt: old, moderationReputation: 20 })),
    );
    const queue = (await voters[0].request('GET', '/api/community-mod/queue')).json();
    expect(queue.items).toHaveLength(1);
    expect(queue.weight).toBe(2);
    const reportId = queue.items[0].id;
    expect(
      (await voters[0].request('POST', `/api/community-mod/reports/${reportId}/vote`, { verdict: 'VIOLATES' })).json()
        .action,
    ).toBe('pending');
    expect(
      (await voters[1].request('POST', `/api/community-mod/reports/${reportId}/vote`, { verdict: 'VIOLATES' })).json()
        .action,
    ).toBe('hidden');
    const listed = (await h.app.inject({ method: 'GET', url: `/api/posts/${post.id}/comments` })).json();
    expect(listed).toHaveLength(0);

    const mod = await verifiedUser('mod', { role: 'MODERATOR' });
    await mod.request('POST', '/api/auth/login', { email: 'user_mod@example.com', password: 'senha-super-forte-123' });
    expect((await mod.request('PATCH', `/api/admin/reports/${reportId}`, { status: 'RESOLVED' })).statusCode).toBe(200);
    const v1 = await h.prisma.user.findUnique({ where: { email: 'user_v1@example.com' } });
    expect(v1.moderationReputation).toBe(22);
  });
});

describe('visualizações agregadas', () => {
  it('deduplica por visitante e grava em lote', async () => {
    const { flushViews } = await import('../../src/services/views.js');
    const category = await h.prisma.category.create({ data: { name: 'Games', slug: 'games' } });
    const author = await h.prisma.user.findFirst();
    const post = await h.prisma.post.create({
      data: {
        title: 'Views',
        slug: 'views',
        description: 'descrição longa',
        content: '<p>x</p>',
        categoryId: category.id,
        authorId: author.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    for (let i = 0; i < 3; i++)
      await h.app.inject({ method: 'POST', url: `/api/posts/${post.id}/view`, remoteAddress: '203.0.113.7' });
    await h.app.inject({ method: 'POST', url: `/api/posts/${post.id}/view`, remoteAddress: '203.0.113.8' });
    expect((await h.prisma.post.findUnique({ where: { id: post.id } })).viewCount).toBe(0);
    await flushViews();
    expect((await h.prisma.post.findUnique({ where: { id: post.id } })).viewCount).toBe(2);
    expect(await h.prisma.analyticsEvent.count({ where: { postId: post.id, type: 'POST_VIEW' } })).toBe(2);
  });
});
