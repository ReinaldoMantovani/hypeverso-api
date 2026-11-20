import { defineConfig } from 'vitest/config';
// Unitários: sem banco. Integração (Docker) fica em vitest.integration.config.ts.
// security.jest.test.mjs roda pelo Jest (npm run test:jest).
export default defineConfig({ test: { include: ['tests/*.test.ts'], exclude: ['tests/integration/**'] } });
