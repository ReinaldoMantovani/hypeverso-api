// Entrada para a Hostinger (Arquivo de entrada: server.js).
// O servidor da Hostinger (LiteSpeed/lsnode) carrega este arquivo com require().
// Por isso ele NÃO pode ter "await" no nível de cima: usamos import() dinâmico,
// que carrega a API compilada em dist/ de forma assíncrona.
import('./dist/server.js').catch((error) => {
  console.error('[hypeverso-api] Falha ao iniciar a API:', error);
  process.exit(1);
});