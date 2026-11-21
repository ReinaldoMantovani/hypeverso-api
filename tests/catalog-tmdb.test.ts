import { afterEach, describe, expect, it, vi } from 'vitest';
process.env.DATABASE_URL ??= 'mysql://hypeverso:hypeverso@localhost:3306/hypeverso';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret';
process.env.REDIS_URL = '';
// Chave fictícia no formato v3 (32 caracteres hexadecimais).
const FAKE_V3_KEY = '0123456789abcdef0123456789abcdef';
process.env.TMDB_READ_TOKEN = FAKE_V3_KEY;

const { diagnoseProviders } = await import('../src/services/media-catalog.js');

afterEach(() => vi.unstubAllGlobals());

describe('TMDB', () => {
  it('chave v3 (32 caracteres) vai como api_key, sem Bearer', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), headers: (init.headers || {}) as Record<string, string> });
        if (String(url).includes('themoviedb'))
          return new Response(JSON.stringify({ results: [{ id: 268, title: 'Batman', release_date: '1989-06-23' }] }));
        return new Response(JSON.stringify({ data: { Page: { media: [] } } }));
      }),
    );
    const d = await diagnoseProviders();
    const tmdb = calls.find(c => c.url.includes('themoviedb'))!;
    expect(tmdb.url).toContain(`api_key=${FAKE_V3_KEY}`);
    expect(tmdb.headers.Authorization).toBeUndefined();
    expect(d.TMDB.ok).toBe(true);
  });
});
