import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CookieJar, startHarness, type Harness } from './setup.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.stop();
});

const newUser = (n: string) => ({
  name: `Pessoa ${n}`,
  username: `pessoa_${n}`,
  email: `pessoa_${n}@example.com`,
  password: 'senha-super-forte-123',
  acceptTerms: true,
});

describe('cadastro, sessão por cookie e CSRF', () => {
  it('cadastra, registra aceite dos Termos e cria sessão HttpOnly sem expor tokens', async () => {
    const jar = new CookieJar(h.app);
    const res = await jar.request('POST', '/api/auth/register', newUser('a'));
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.accessToken).toBeUndefined();
    const access = res.cookies.find((c: any) => c.name === 'nv_access');
    expect(access?.httpOnly).toBe(true);
    expect(jar.cookies.get('nv_csrf')).toBeTruthy();
    const user = await h.prisma.user.findUnique({ where: { email: 'pessoa_a@example.com' } });
    expect(user.termsAcceptedAt).toBeTruthy();
    expect(user.termsVersion).toBeTruthy();

    const me = await jar.request('GET', '/api/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe('pessoa_a');
  });

  it('recusa escrita com cookie mas sem CSRF, aceita com CSRF', async () => {
    const jar = new CookieJar(h.app);
    await jar.request('POST', '/api/auth/register', newUser('b'));
    const noCsrf = await h.app.inject({
      method: 'PATCH',
      url: '/api/me',
      cookies: Object.fromEntries(jar.cookies),
      payload: { bio: 'oi' },
    });
    expect(noCsrf.statusCode).toBe(403);
    const ok = await jar.request('PATCH', '/api/me', { bio: 'oi' });
    expect(ok.statusCode).toBe(200);
  });

  it('cliente mobile recebe tokens no corpo/header e usa Bearer sem CSRF', async () => {
    await new CookieJar(h.app).request('POST', '/api/auth/register', newUser('c'));
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-client-platform': 'mobile' },
      payload: { email: 'pessoa_c@example.com', password: 'senha-super-forte-123' },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().accessToken;
    expect(token).toBeTruthy();
    expect(login.headers['x-refresh-token']).toBeTruthy();
    const patch = await h.app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { bio: 'mobile' },
    });
    expect(patch.statusCode).toBe(200);
  });

  it('rotaciona refresh token e revoga tudo quando um token antigo é reutilizado', async () => {
    const jar = new CookieJar(h.app);
    await jar.request('POST', '/api/auth/register', newUser('d'));
    const oldRefresh = jar.cookies.get('nv_refresh')!;
    const r1 = await jar.request('POST', '/api/auth/refresh');
    expect(r1.statusCode).toBe(200);
    expect(jar.cookies.get('nv_refresh')).not.toBe(oldRefresh);
    // Simula o reuso após a janela de tolerância de 30 s.
    await h.prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const attacker = await h.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { nv_refresh: oldRefresh, nv_csrf: jar.cookies.get('nv_csrf')! },
      headers: { 'x-csrf-token': jar.cookies.get('nv_csrf')! },
    });
    expect(attacker.statusCode).toBe(401);
    const victim = await jar.request('POST', '/api/auth/refresh');
    expect(victim.statusCode).toBe(401);
  });

  it('exige e-mail verificado para comentar/publicar', async () => {
    const jar = new CookieJar(h.app);
    await jar.request('POST', '/api/auth/register', newUser('e'));
    const res = await jar.request('POST', '/api/community/posts', { content: 'primeiro post' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('EMAIL_NOT_VERIFIED');
    await h.prisma.user.update({ where: { email: 'pessoa_e@example.com' }, data: { emailVerifiedAt: new Date() } });
    const ok = await jar.request('POST', '/api/community/posts', { content: 'primeiro post' });
    expect(ok.statusCode).toBe(201);
  });
});

describe('2FA obrigatório para administração', () => {
  it('bloqueia admin sem 2FA, permite após ativar e exige o código no login', async () => {
    const { hotp, currentStep } = await import('../../src/lib/totp.js');
    const jar = new CookieJar(h.app);
    await jar.request('POST', '/api/auth/register', newUser('admin'));
    await h.prisma.user.update({
      where: { email: 'pessoa_admin@example.com' },
      data: { role: 'ADMIN', emailVerifiedAt: new Date() },
    });
    // Novo login para o token carregar o papel ADMIN.
    await jar.request('POST', '/api/auth/login', {
      email: 'pessoa_admin@example.com',
      password: 'senha-super-forte-123',
    });
    const blocked = await jar.request('GET', '/api/admin/dashboard');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('MFA_SETUP_REQUIRED');

    const setup = await jar.request('POST', '/api/me/mfa/setup');
    expect(setup.statusCode).toBe(200);
    const { secret } = setup.json();
    const enable = await jar.request('POST', '/api/me/mfa/enable', { code: hotp(secret, currentStep()) });
    expect(enable.statusCode).toBe(200);
    expect(enable.json().recoveryCodes).toHaveLength(10);
    expect((await jar.request('GET', '/api/admin/dashboard')).statusCode).toBe(200);

    const fresh = new CookieJar(h.app);
    const login = await fresh.request('POST', '/api/auth/login', {
      email: 'pessoa_admin@example.com',
      password: 'senha-super-forte-123',
    });
    expect(login.json().mfaRequired).toBe(true);
    expect(fresh.cookies.get('nv_access')).toBeUndefined();
    const wrong = await fresh.request('POST', '/api/auth/mfa/verify', {
      mfaToken: login.json().mfaToken,
      code: '000000',
    });
    expect(wrong.statusCode).toBe(401);
    const recovery = enable.json().recoveryCodes[0];
    const ok = await fresh.request('POST', '/api/auth/mfa/verify', { mfaToken: login.json().mfaToken, code: recovery });
    expect(ok.statusCode).toBe(200);
    expect((await fresh.request('GET', '/api/admin/dashboard')).statusCode).toBe(200);
    // Código de recuperação é de uso único.
    const again = await new CookieJar(h.app).request('POST', '/api/auth/mfa/verify', {
      mfaToken: login.json().mfaToken,
      code: recovery,
    });
    expect(again.statusCode).toBe(401);
  });
});
