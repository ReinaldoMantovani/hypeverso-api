import { afterEach, describe, expect, it, vi } from 'vitest';
process.env.DATABASE_URL ??= 'mysql://hypeverso:hypeverso@localhost:3306/hypeverso';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret';
process.env.REDIS_URL = '';

const { translateHtml, translateSegments, normalizeLocale, postHash } = await import('../src/services/translation.js');
const { translationSchema } = await import('../src/services/settings.js');

/** Ollama falso: "traduz" colocando [EN] na frente de cada item. */
function fakeOllama(onCall?: (items: string[]) => void, mangle = false) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const user: string = body.messages[1].content;
    const items: string[] = JSON.parse(user.slice(user.lastIndexOf('\n\n') + 2));
    onCall?.(items);
    const out = mangle && items.length > 1 ? items.slice(1) : items.map(i => `[EN] ${i}`);
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ items: out }) } }), { status: 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Traduções', () => {
  it('normaliza o idioma pedido pelo site', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('ES')).toBe('es');
    expect(normalizeLocale('pt-BR')).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
    expect(normalizeLocale('fr')).toBeNull();
  });

  it('traduz só os textos do HTML e mantém tags, links, imagens e códigos de produto', async () => {
    const seen: string[][] = [];
    vi.stubGlobal('fetch', fakeOllama(i => seen.push(i)));
    const html =
      '<h2>Novo trailer</h2><p>Veja o <a href="https://youtu.be/x">trailer</a> agora.</p>' +
      '<figure><img src="/uploads/a.webp" alt="Pôster do filme"><figcaption>Divulgação</figcaption></figure>' +
      '<p>[[produto:caneca-gta]]</p><pre>code()</pre><p>2026</p>';
    const out = await translateHtml(html, 'en', 'qwen3:4b-instruct');
    expect(out).toContain('<h2>[EN] Novo trailer</h2>');
    expect(out).toContain('<a href="https://youtu.be/x">[EN] trailer</a>');
    expect(out).toContain('alt="[EN] Pôster do filme"');
    expect(out).toContain('src="/uploads/a.webp"');
    expect(out).toContain('<p>[[produto:caneca-gta]]</p>');
    expect(out).toContain('<pre>code()</pre>');
    expect(out).toContain('<p>2026</p>');
    // Espaços em volta dos textos preservados ("Veja o " + link + " agora.")
    expect(out).toContain('[EN] Veja o <a');
    expect(seen.flat()).not.toContain('[[produto:caneca-gta]]');
  });

  it('se a IA devolver número errado de itens, traduz um por um sem desalinhar', async () => {
    let calls = 0;
    const mangled = fakeOllama(() => calls++, true);
    vi.stubGlobal('fetch', mangled);
    const out = await translateSegments(['Um', 'Dois', 'Três'], 'es', 'm');
    expect(out).toHaveLength(3);
    // 2 tentativas em lote + 3 chamadas individuais
    expect(calls).toBe(5);
  });

  it('o hash muda quando o artigo muda', () => {
    const base = { title: 'A', description: 'B', content: '<p>C</p>', seoTitle: null, seoDescription: null };
    expect(postHash(base)).toBe(postHash({ ...base }));
    expect(postHash(base)).not.toBe(postHash({ ...base, content: '<p>D</p>' }));
  });

  it('configurações de tradução têm padrões seguros', () => {
    const s = translationSchema.parse({});
    expect(s.enabled).toBe(true);
    expect(s.locales).toEqual(['en', 'es']);
    expect(translationSchema.parse({ locales: ['fr'] }).locales).toEqual(['en', 'es']);
  });
});
