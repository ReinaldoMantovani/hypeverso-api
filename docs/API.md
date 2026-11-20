# API

Prefixo: `/api`. Swagger em `/docs`.

Principais grupos:

- `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`
- `POST /auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`
- `GET /posts`, `GET /posts/:slug`, comentários e favoritos
- `GET /categories`, `GET /tags`
- `GET /me`, `PATCH /me`, perfis, follow e notificações
- `GET /community/feed`, CRUD/interações da comunidade
- `GET/POST/PATCH/DELETE /library`
- `GET /search`, `GET /recommendations`
- `/admin/*` para CMS, usuários, métricas e moderação
- `POST /uploads`
- `POST /billing/checkout`, `POST /billing/webhook`
- `POST /analytics/event`

Rotas protegidas usam `Authorization: Bearer <access token>`. O web usa refresh token rotativo em cookie HttpOnly. O app usa refresh token em SecureStore e o envia somente à rota de refresh.

## AI News Studio (EDITOR/ADMIN)

- `GET /api/admin/ai-news/health` — status de SearXNG, Ollama e modelo local.
- `GET /api/admin/ai-news/jobs` — fila e histórico de geração.
- `POST /api/admin/ai-news/jobs` — enfileira 1–5 rascunhos. Corpo: `categoryId?`, `query?`, `requestedDrafts`, `timeRange` (`day|week|month`).
- `POST /api/admin/ai-news/jobs/:id/retry` — reprocessa job que falhou ou foi cancelado.
- `POST /api/admin/ai-news/jobs/:id/cancel` — cancela job pendente/em processamento.
- `DELETE /api/admin/ai-news/jobs/:id` — remove o job da fila/listagem; artigos já criados são preservados.
- `GET /api/admin/ai-news/drafts/:postId` — proveniência, fontes e créditos do rascunho.

Todo post criado pelo AI News Studio nasce com `status=DRAFT`.

## Shop (afiliados)

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/api/shop/products?category=&store=&q=` | público | Produtos ativos + listas de categorias e lojas (cache de 60 s no Redis). |
| GET | `/api/shop/go/:id` | público | Conta o clique (1 por visitante/produto a cada 30 min) e redireciona (302) para o link de afiliado. |
| GET | `/api/admin/shop/products` | EDITOR/ADMIN | Todos os produtos e estatísticas de cliques. |
| POST | `/api/admin/shop/preview` | EDITOR/ADMIN | `{ url }` → lê a página da loja (segue encurtadores, anti-SSRF) e devolve título, imagem, preço, loja e avisos. |
| POST | `/api/admin/shop/products` | EDITOR/ADMIN | Cria produto. `importImage: true` baixa a foto e guarda cópia em `/uploads/shop-*`. |
| PATCH | `/api/admin/shop/products/:id` | EDITOR/ADMIN | Altera só os campos enviados. |
| DELETE | `/api/admin/shop/products/:id` | EDITOR/ADMIN | Remove o produto. |

Os cliques também geram `AnalyticsEvent` do tipo `AFFILIATE_CLICK`, somados no painel de Receita.
