import { describe, it, expect } from 'vitest';
process.env.DATABASE_URL ??= 'mysql://hypeverso:hypeverso@localhost:3306/hypeverso';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret';
describe('health', () => {
  it('returns ok', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('ok');
    await app.close();
  });
});
