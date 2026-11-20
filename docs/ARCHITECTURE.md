# Arquitetura NEXVERSE

```text
Web Next.js ─┐
Mobile Expo ─┼── HTTPS/REST ── Fastify API ── Prisma ── PostgreSQL
             │                      │
             └──────────────────────┴──────── Redis
```

O monorepo é separado em `apps/web`, `apps/api`, `apps/mobile` e pacotes compartilhados. A API é a fonte de verdade para autenticação, autorização, conteúdo, interações, gamificação e billing.

## Módulos da API

- Auth: cadastro, login, refresh rotativo, logout, confirmação de email e recuperação de senha.
- Content/CMS: posts, categorias, tags, agendamento, premium, comentários, favoritos e denúncias.
- Users: perfil, seguidores e notificações.
- Community: feed, publicações, reações e comentários.
- Library: estados pessoais para filmes/séries/games/anime/mangá/HQ.
- Search: pesquisa cruzada e histórico.
- Recommendations: ranking inicial por categorias derivadas de favoritos e interações.
- Admin: métricas, usuários e moderação.
- Billing: Stripe Checkout e sincronização da assinatura.
- Analytics: eventos próprios para métricas de conteúdo.

## Evolução recomendada para grande escala

Trocar `uploads` local por S3/R2, migrar busca para PostgreSQL FTS/Meilisearch/OpenSearch, usar fila (BullMQ/RabbitMQ) para emails e jobs, separar analytics operacional de eventos de produto, adicionar CDN e observabilidade com OpenTelemetry.
