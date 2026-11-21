import { afterEach, describe, expect, it, vi } from 'vitest';
process.env.DATABASE_URL ??= 'mysql://hypeverso:hypeverso@localhost:3306/hypeverso';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret';
process.env.REDIS_URL = '';
process.env.METRON_USERNAME = 'usuario-teste';
process.env.METRON_PASSWORD = 'senha-teste';

const { diagnoseProviders, providerAvailability } = await import('../src/services/media-catalog.js');

afterEach(() => vi.unstubAllGlobals());

function fakeApis(seen: { url: string; headers: Record<string, string> }[]) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    seen.push({ url: u, headers: (init.headers || {}) as Record<string, string> });
    if (u.includes('metron.cloud'))
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 34067,
              number: '1',
              cover_date: '2016-08-01',
              image: 'https://static.metron.cloud/media/issue/batman-1.jpg',
              series: { name: 'Batman', volume: 3, year_began: 2016 },
            },
          ],
        }),
      );
    if (u.includes('googleapis.com/books'))
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'abc123XYZ',
              volumeInfo: {
                title: 'Turma da Mônica',
                subtitle: 'Laços',
                authors: ['Vitor Cafaggi', 'Lu Cafaggi'],
                publisher: 'Panini',
                publishedDate: '2013-06',
                categories: ['Comics & Graphic Novels / General'],
                imageLinks: { thumbnail: 'http://books.google.com/books/content?id=abc&zoom=1&edge=curl' },
                industryIdentifiers: [{ type: 'ISBN_13', identifier: '9788565484383' }],
              },
            },
            { id: 'livro-nao-hq', volumeInfo: { title: 'Receitas', categories: ['Cooking'] } },
          ],
        }),
      );
    return new Response(JSON.stringify({ results: [], data: { Page: { media: [] } } }));
  });
}

describe('HQs no catálogo', () => {
  it('Metron usa Basic Auth e monta título com o ano; Google Books filtra só quadrinhos', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', fakeApis(seen));
    const d = await diagnoseProviders();
    expect(d.METRON.ok).toBe(true);
    expect(d.GOOGLE_BOOKS.ok).toBe(true);
    // o livro de receitas foi descartado (não é HQ)
    expect(d.GOOGLE_BOOKS.results).toBe(1);
    const metron = seen.find(s => s.url.includes('metron.cloud'))!;
    expect(metron.url).toContain('series_name=Batman');
    expect(metron.headers.Authorization).toBe(`Basic ${Buffer.from('usuario-teste:senha-teste').toString('base64')}`);
    const books = seen.find(s => s.url.includes('googleapis.com/books'))!;
    expect(books.url).toContain('subject%3Acomics');
    expect(providerAvailability()).toMatchObject({ METRON: true, GOOGLE_BOOKS: true });
  });
});

describe('Metron com token', () => {
  it('manda "Token <chave>" e, se recusado, tenta "Bearer"', async () => {
    vi.resetModules();
    process.env.METRON_API_TOKEN = 'token-ficticio-123';
    const { diagnoseProviders: diag } = await import('../src/services/media-catalog.js');
    const auths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (String(url).includes('metron.cloud')) {
          const auth = (init.headers as Record<string, string>).Authorization;
          auths.push(auth);
          if (auth.startsWith('Token ')) return new Response('{"detail":"no"}', { status: 401 });
          return new Response(JSON.stringify({ results: [{ id: 1, number: '1', series: { name: 'Saga', year_began: 2012 } }] }));
        }
        return new Response(JSON.stringify({ items: [], data: { Page: { media: [] } } }));
      }),
    );
    const d = await diag();
    expect(auths).toEqual(['Token token-ficticio-123', 'Bearer token-ficticio-123']);
    expect(d.METRON.ok).toBe(true);
    delete process.env.METRON_API_TOKEN;
  });
});
