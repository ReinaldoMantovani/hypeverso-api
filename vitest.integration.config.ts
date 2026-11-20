import { defineConfig } from 'vitest/config';
// Testes de integração: sobem um MySQL real via Testcontainers (sem Redis, como na Hostinger).
// Requer Docker. Rode com: npm run test:integration
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 240_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
