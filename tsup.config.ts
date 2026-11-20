import { defineConfig } from 'tsup';

// Build de produção: um arquivo por processo. Na Hostinger o Entry file é dist/server.js.
// Os workers (IA, descoberta, filas) rodam no seu PC (veja docker-compose.local-ai.yml).
export default defineConfig({
  entry: [
    'src/server.ts',
    'src/ai-worker.ts',
    'src/discovery-worker.ts',
    'src/queue-worker.ts',
    'src/shop-worker.ts',
    'src/moderation-worker.ts',
  ],
  format: ['esm'],
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  target: 'node22',
  // O Prisma Client (CJS + engine nativa) precisa ficar fora do bundle.
  external: ['@prisma/client', '.prisma/client'],
  // Permite que dependências CJS embutidas usem require() dentro do bundle ESM.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
