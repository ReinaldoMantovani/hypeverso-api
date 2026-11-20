import('./dist/server.js').catch((error) => {
  console.error('[hypeverso-api] Falha ao iniciar a API:', error);
  process.exit(1);
});
