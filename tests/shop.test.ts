import { describe, expect, it } from 'vitest';
process.env.DATABASE_URL ??= 'mysql://hypeverso:hypeverso@localhost:3306/hypeverso';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret';
process.env.GATEWAY_SHARED_SECRET = 'segredo-de-teste-do-gateway-123456';
process.env.REDIS_URL = '';

const { detectStore, isAcceptableAffiliateUrl } = await import('../src/services/shop.js');
const { stringList } = await import('../src/lib/json-array.js');
const { redis } = await import('../src/lib/redis.js');
const { affiliateSchema, shopTextSchema, aiSchema } = await import('../src/services/settings.js');

describe('Shop · loja', () => {
  it('detecta lojas pelos domínios e encurtadores de afiliado', () => {
    expect(detectStore('https://amzn.to/3abcd')).toBe('Amazon');
    expect(detectStore('https://www.amazon.com.br/dp/B0TEST')).toBe('Amazon');
    expect(detectStore('https://mercadolivre.com/sec/1abc')).toBe('Mercado Livre');
    expect(detectStore('https://produto.mercadolivre.com.br/MLB-123')).toBe('Mercado Livre');
    expect(detectStore('https://s.shopee.com.br/xyz')).toBe('Shopee');
    expect(detectStore('https://www.magazinevoce.com.br/magazinehype/p/123')).toBe('Magalu');
    expect(detectStore('https://www.lojanerd.com.br/item')).toBe('Lojanerd');
  });
  it('recusa links locais e com credenciais', () => {
    expect(isAcceptableAffiliateUrl('https://amzn.to/x')).toBe(true);
    expect(isAcceptableAffiliateUrl('http://localhost:4000/x')).toBe(false);
    expect(isAcceptableAffiliateUrl('https://u:p@loja.com/x')).toBe(false);
    expect(isAcceptableAffiliateUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('MySQL · listas em JSON', () => {
  it('lê listas salvas como JSON', () => {
    expect(stringList(['a', 'b', 3])).toEqual(['a', 'b']);
    expect(stringList('["x"]')).toEqual(['x']);
    expect(stringList(null)).toEqual([]);
  });
});

describe('Sem Redis (Hostinger) · cache em memória', () => {
  it('suporta SET NX/EX, hash, lista e scan', async () => {
    expect(await redis.set('k', '1', 'EX', 60, 'NX')).toBe('OK');
    expect(await redis.set('k', '2', 'EX', 60, 'NX')).toBeNull();
    expect(await redis.get('k')).toBe('1');
    await redis.multi().hincrby('h', 'p1', 2).rpush('l', 'a', 'b').exec();
    expect(await redis.hgetall('h')).toEqual({ p1: '2' });
    await redis.rename('h', 'h2');
    expect(await redis.hgetall('h2')).toEqual({ p1: '2' });
    expect(await redis.lpop('l', 10)).toEqual(['a', 'b']);
    await redis.set('posts:1', 'x');
    const [, keys] = await redis.scan('0', 'MATCH', 'posts:*', 'COUNT', 10);
    expect(keys).toEqual(['posts:1']);
  });
});

describe('Configurações', () => {
  it('preenche padrões e valida IDs de afiliado', () => {
    const shop = shopTextSchema.parse({});
    expect(shop.modalMessage).toContain('{nome}');
    expect(aiSchema.parse({}).shopModel).toBe('qwen3:4b-instruct');
    expect(affiliateSchema.parse({ amazonTag: 'hypeverso-20' }).amazonTag).toBe('hypeverso-20');
    expect(() => affiliateSchema.parse({ amazonTag: 'tag com espaço' })).toThrow();
  });
});

describe('Gateway · IP real do visitante', () => {
  it('só aceita x-hv-client-ip com o segredo correto', async () => {
    const { buildApp } = await import('../src/app.js');
    const { clientIp } = await import('../src/lib/client-ip.js');
    const app = await buildApp();
    app.get('/__ip', async req => ({ ip: clientIp(req) }));
    const trusted = await app.inject({
      method: 'GET',
      url: '/__ip',
      headers: { 'x-hv-gateway-secret': 'segredo-de-teste-do-gateway-123456', 'x-hv-client-ip': '203.0.113.9' },
    });
    expect(trusted.json().ip).toBe('203.0.113.9');
    const forged = await app.inject({
      method: 'GET',
      url: '/__ip',
      headers: { 'x-hv-gateway-secret': 'errado', 'x-hv-client-ip': '203.0.113.9' },
    });
    expect(forged.json().ip).not.toBe('203.0.113.9');
    await app.close();
  });
});

describe('Shop · verificação automática', async () => {
  const { evaluateCheck } = await import('../src/services/shop-scraper/check.js');
  const { extractProductData } = await import('../src/services/shop-scraper/extract.js');
  const current = { affiliateUrl: 'https://amzn.to/x', priceCents: 12990, originalPriceCents: null };
  const found = { priceCents: 12990, originalPriceCents: null, available: true, title: 'Funko' };
  it('classifica preço igual, mudança, esgotado, quebrado e bloqueado', () => {
    expect(evaluateCheck(current, found, { status: 200, blocked: false }).status).toBe('OK');
    const changed = evaluateCheck(current, { ...found, priceCents: 9990 }, { status: 200, blocked: false });
    expect(changed.status).toBe('PRICE_CHANGED');
    expect(changed.message).toMatch(/R\$ 129,90 para R\$ 99,90/);
    expect(evaluateCheck(current, { ...found, available: false }, { status: 200, blocked: false }).status).toBe('OUT_OF_STOCK');
    expect(evaluateCheck(current, found, { status: 404, blocked: false }).status).toBe('BROKEN');
    expect(
      evaluateCheck(current, { priceCents: null, originalPriceCents: null, available: null, title: null }, { status: 200, blocked: true }).status,
    ).toBe('BLOCKED');
  });
  it('lê estoque pelo JSON-LD e pelos textos da Amazon', () => {
    const ld = `<script type="application/ld+json">{"@type":"Product","name":"X","offers":{"price":"10","availability":"https://schema.org/OutOfStock"}}</script>`;
    expect(extractProductData(ld, 'https://loja.com.br/x').available).toBe(false);
    const amz = `<span id="productTitle">Y</span><div id="availability"><span>Em estoque</span></div>`;
    expect(extractProductData(amz, 'https://www.amazon.com.br/dp/B0X').available).toBe(true);
    const amzOut = `<span id="productTitle">Y</span><div id="availability"><span>Não disponível.</span></div>`;
    expect(extractProductData(amzOut, 'https://www.amazon.com.br/dp/B0X').available).toBe(false);
  });
});

describe('Shop · coleções', async () => {
  const { collectionItems } = await import('../src/routes/shop.js');
  const p = (id: string, category: string, store: string, priceCents: number, originalPriceCents: number | null = null) => ({
    id,
    category,
    store,
    priceCents,
    originalPriceCents,
  });
  const all = [
    p('a', 'Colecionáveis', 'Amazon', 9990, 12990),
    p('b', 'Colecionáveis', 'Shopee', 15990),
    p('c', 'Games', 'Amazon', 4990),
    p('d', 'Mangás', 'Amazon', 3990, 4990),
  ];
  it('junta escolhidos à mão (na ordem) com os filtros', () => {
    const r = collectionItems({ productIds: ['d'], category: null, store: null, maxPriceCents: 10000, onlyDiscount: false }, all);
    expect(r.map(x => x.id)).toEqual(['d', 'a', 'c']);
  });
  it('filtra só promoções de uma categoria', () => {
    const r = collectionItems({ productIds: null, category: 'Colecionáveis', store: null, maxPriceCents: null, onlyDiscount: true }, all);
    expect(r.map(x => x.id)).toEqual(['a']);
  });
  it('sem filtros mostra só os escolhidos', () => {
    const r = collectionItems({ productIds: ['c', 'zzz'], category: null, store: null, maxPriceCents: null, onlyDiscount: false }, all);
    expect(r.map(x => x.id)).toEqual(['c']);
  });
});
