# Segurança

Implementado: Argon2id, JWT curto, refresh token aleatório com hash SHA-256 no banco e rotação, cookie HttpOnly/SameSite, Helmet, CORS allowlist, rate limit, Zod, sanitização HTML do CMS, RBAC, tamanho máximo de body/upload e invalidação de sessões no reset de senha.

Antes de produção: trocar secrets, usar HTTPS obrigatório, SMTP confiável, segredo de webhook Stripe, proxy com limites adicionais, backups cifrados, storage externo de mídia, SAST/dependency scanning e logs/alertas centralizados. Para múltiplas instâncias, evite `redis.keys` e adote versionamento de cache ou SCAN.

## AI News Studio

O coletor editorial valida URLs externas antes de buscar páginas, bloqueia localhost/faixas privadas, revalida redirects, limita tamanho e timeout de respostas e não persiste o corpo integral das matérias. A saída do LLM passa por sanitização HTML antes de ser gravada. A busca usa SafeSearch do SearXNG e os endpoints de geração são restritos a `EDITOR`/`ADMIN`.

Imagens automáticas são buscadas no Wikimedia Commons e filtradas por metadados de licença compatíveis com CC BY/CC BY-SA/CC0/domínio público. Créditos e URLs de origem ficam persistidos para revisão editorial.

## Hardening de 15/10/2026

Veja `docs/AUDITORIA_2026-10-15.md` para a lista completa. Resumo: portas de infraestrutura só em loopback (e `!reset` em produção), `TRUST_PROXY` restrito, falha de inicialização com segredos de exemplo em produção, Swagger desligado em produção, validação de magic bytes em uploads, iframes em allowlist, escape do JSON-LD, rate limits por rota, detecção de reuso de refresh token, cabeçalhos de segurança no Web, containers sem root, Consent Mode v2 e direitos LGPD (exportar/excluir conta).

## V19 (15/10/2026)

Sessão em cookies HttpOnly + CSRF double-submit, CSP com nonce e `strict-dynamic`, 2FA TOTP obrigatório para ADMIN/EDITOR, e-mail verificado para conteúdo público, Cloudflare Turnstile, reprocessamento de imagens com sharp (sem EXIF/GPS), rate limit no Redis, Redis com senha/TLS, SCAN no lugar de KEYS, allowlist de endpoints de push, CodeQL + Semgrep + npm audit + Dependabot no CI. Veja `docs/V19_MELHORIAS_E_FEATURES.md`.
