import { describe, it, expect } from 'vitest';
process.env.DATABASE_URL ??= 'mysql://hypeverso:hypeverso@localhost:3306/hypeverso';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret';

describe('TOTP (RFC 6238)', async () => {
  const { base32Encode, hotp, verifyTotp, generateTotpSecret, generateRecoveryCodes } =
    await import('../src/lib/totp.js');
  // Segredo de teste da RFC 6238 ("12345678901234567890") e vetores para SHA-1 com 6 dígitos.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('gera os códigos dos vetores oficiais', () => {
    expect(hotp(secret, Math.floor(59 / 30))).toBe('287082');
    expect(hotp(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(hotp(secret, Math.floor(1234567890 / 30))).toBe('005924');
  });
  it('aceita ±1 janela e bloqueia reuso do mesmo passo', () => {
    const now = 1234567890 * 1000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(secret, '005924', null, now)).toBe(step);
    expect(verifyTotp(secret, hotp(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, '005924', step, now)).toBeNull();
    expect(verifyTotp(secret, '000000', null, now)).toBeNull();
    expect(verifyTotp(secret, 'abc', null, now)).toBeNull();
  });
  it('gera segredos e códigos de recuperação únicos', () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
  });
});

describe('crypto-box (AES-256-GCM)', async () => {
  const { seal, open } = await import('../src/lib/crypto-box.js');
  it('cifra e decifra', () => {
    const sealed = seal('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(open(sealed)).toBe('JBSWY3DPEHPK3PXP');
  });
  it('detecta adulteração', () => {
    const parts = seal('segredo').split('.');
    parts[3] = Buffer.from('outra coisa').toString('base64url');
    expect(() => open(parts.join('.'))).toThrow();
  });
});

describe('signed-token', async () => {
  const { signToken, verifySignedToken } = await import('../src/lib/signed-token.js');
  it('valida propósito, assinatura e expiração', () => {
    const t = signToken({ purpose: 'mfa-login', sub: 'u1' }, 60);
    expect(verifySignedToken(t, 'mfa-login')?.sub).toBe('u1');
    expect(verifySignedToken(t, 'outro')).toBeNull();
    expect(verifySignedToken(t.slice(0, -2) + 'xx', 'mfa-login')).toBeNull();
    expect(verifySignedToken(signToken({ purpose: 'mfa-login' }, -1), 'mfa-login')).toBeNull();
  });
});

describe('push endpoint allowlist (anti-SSRF)', async () => {
  const { isAllowedPushEndpoint } = await import('../src/services/push.js');
  it('aceita serviços de push conhecidos', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
  });
  it('recusa hosts internos ou arbitrários', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://redis:6379/')).toBe(false);
  });
});
