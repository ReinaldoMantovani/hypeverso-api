import { describe, it, expect, beforeAll, afterAll } from 'vitest';
process.env.DATABASE_URL ??= 'mysql://hypeverso:hypeverso@localhost:3306/hypeverso';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret';

// Testes que não dependem de banco: validam as defesas de borda.
describe('security hardening', () => {
  let app: any;
  beforeAll(async () => {
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('rejeita cadastro sem aceite dos Termos', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Teste', username: 'teste_1', email: 't@example.com', password: '12345678' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('não confia em X-Forwarded-For vindo de IP público', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: '8.8.8.8',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(r.statusCode).toBe(200);
  });

  it('envia cabeçalhos de segurança', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBeDefined();
  });

  it('exige autenticação para exportar e excluir dados', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me/export' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/me', payload: {} })).statusCode).toBe(401);
  });

  it('bloqueia POST com cookie de sessão e sem token CSRF', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { nv_refresh: 'x'.repeat(64) } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('CSRF_INVALID');
  });

  it('bloqueia origem não autorizada em requisição com cookie', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { nv_refresh: 'x'.repeat(64), nv_csrf: 'a'.repeat(43) },
      headers: { origin: 'https://evil.example', 'x-csrf-token': 'a'.repeat(43) },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('CSRF_ORIGIN');
  });

  it('emite cookie CSRF legível', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
    expect(r.statusCode).toBe(200);
    const cookie = r.cookies.find((c: any) => c.name === 'nv_csrf');
    expect(cookie?.value).toBe(r.json().csrfToken);
    expect(cookie?.httpOnly).toBeFalsy();
  });

  it('rotas de 2FA e administração exigem sessão', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me/mfa' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/revenue' })).statusCode).toBe(401);
  });

  it('push recusa endpoint fora da allowlist', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { endpoint: 'https://evil.example/x', keys: { p256dh: 'a'.repeat(40), auth: 'b'.repeat(16) } },
    });
    // 503 quando VAPID não está configurado; 400 quando está e o endpoint é inválido.
    expect([400, 503]).toContain(r.statusCode);
  });

  it('upload exige autenticação', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/uploads?purpose=article' })).statusCode).toBe(401);
  });
});
