# Hypeverso API (Hostinger Business + MySQL)

API do Hypeverso em Fastify + Prisma, preparada para rodar como **Node.js Web App** no plano **Business** da Hostinger, usando o **MySQL** do próprio plano. Ela não precisa de Docker, Redis, PostgreSQL nem VPS.

```text
            Hostinger Business                                   Seu PC
 ┌─────────────────────────────────────────┐        ┌────────────────────────────────────┐
 │ seudominio.com.br    → hypeverso-web    │        │ hypeverso-cms (localhost:3001)     │
 │ api.seudominio.com.br → hypeverso-api ──┼─MySQL──┼─ ai-worker (IA Notícias)           │
 │ MySQL (hPanel)                          │ remoto │  discovery-worker (recomendações)  │
 └─────────────────────────────────────────┘        │  Ollama (LLMs), SearXNG, extrator  │
                                                     └────────────────────────────────────┘
```

**O que mudou para caber no plano Business**

| Antes (VPS/Docker) | Agora |
|---|---|
| PostgreSQL + pgvector | MySQL/MariaDB da Hostinger. Os vetores das recomendações ficam em JSON e a similaridade é calculada na API. |
| Redis (cache, rate limit, filas) | Cache e deduplicação em memória. Basta deixar `REDIS_URL` vazio; o Redis continua opcional. |
| BullMQ + workers no servidor | Os workers rodam **no seu PC** e leem os pedidos direto do MySQL (Remote MySQL). |
| Meilisearch | Opcional. Sem ele, a busca roda no MySQL. |
| Uploads em disco | Imagens ficam no **MySQL** (tabela `MediaAsset`), porque a Hostinger recria a pasta do app a cada deploy. |
| Moderação NudeNet (Python) | Desligada por padrão (`IMAGE_MODERATION_ENABLED=false`). |

---

## 1. Banco de dados (hPanel)

1. **Sites › Bancos de dados › MySQL**: crie o banco e o usuário. Anote nome, usuário e senha.
2. **Remote MySQL**: adicione o IP do seu PC (ou "Qualquer host"). Isso permite que a IA local e o comando `npm run db:sync` acessem o banco. Na mesma tela aparece o **hostname remoto** do MySQL.

## 2. Publicar a API na Hostinger

1. Crie um subdomínio, por exemplo `api.seudominio.com.br`.
2. **Adicionar site › Node.js Web App**, apontando para este repositório (ou envie o .zip sem `node_modules`).
3. Configurações de build:

   | Campo | Valor |
   |---|---|
   | Tipo de aplicação | Fastify |
   | Node.js | 22.x |
   | Script de build | `build` |
   | Diretório de saída | *(vazio)* |
   | Arquivo de entrada | `dist/server.js` |

4. **Variáveis de ambiente**: copie de `.env.example` e troque todos os `TROQUE_…`. O host do `DATABASE_URL` costuma ser `localhost`.
5. Faça o deploy. O build roda `prisma generate`, sincroniza o banco (`prisma db push` + categorias) e compila a API. Teste em `https://api.seudominio.com.br/health`.

Se o build avisar que não conseguiu sincronizar o banco, rode no seu PC, com o `DATABASE_URL` remoto:

```bash
npm install
npm run db:sync
```

### Primeiro administrador (no seu PC, apontando para o MySQL da Hostinger)

```bash
# Windows PowerShell: use $env:NOME="valor" em vez de NOME=valor
DATABASE_URL="mysql://USUARIO:SENHA@HOST_REMOTO:3306/BANCO" \
ADMIN_NAME="Seu Nome" ADMIN_USERNAME="admin" ADMIN_EMAIL="voce@seudominio.com.br" ADMIN_PASSWORD="senha-forte-12+" \
npm run admin:create
```

Depois, entre no CMS e ative o 2FA (ícone de escudo).

## 3. IA no seu PC (LLMs, IA Notícias e recomendações)

Use uma das opções abaixo. As duas precisam do `.env.worker`:

```bash
cp .env.worker.example .env.worker   # DATABASE_URL = hostname REMOTO do MySQL + PUBLIC_WEB_URL
```

**Opção A, Docker Desktop (recomendada, inclui busca SearXNG e extrator):**

```bash
docker compose -f docker-compose.local-ai.yml --env-file .env.worker up -d --build
```

**Opção B, sem Docker:** instale o [Ollama](https://ollama.com/download) e rode:

```bash
npm install
npm run worker:local
```

Sem SearXNG, a IA Notícias usa o fallback por RSS automaticamente.

Na primeira vez os modelos são baixados (`qwen3:4b-instruct`, ~2,5 GB, e `qwen3-embedding:0.6b`). Com GPU NVIDIA, descomente o bloco `deploy` do `ollama` no compose.

O que sobe no seu PC:

| Serviço | Para quê | Saúde |
|---|---|---|
| `ai-worker` + `ollama` + `searxng` + `extractor` | IA Notícias (LLMs) | http://localhost:4010/health |
| `discovery-worker` | Recomendações "parecidos com…" | :4020 |
| `shop-worker` | Confere preço, estoque e links da Shop a cada N horas, atualiza preços, oculta esgotados/quebrados e grava o histórico de preço | :4040 |
| `moderation-worker` + `moderator` (NudeNet) | Aprova/recusa imagens de usuários que a Hostinger salvou como pendentes | :4050 |
| `mysql-backup` | Backup diário do MySQL em `./backups` (inclui as imagens) | — |

No modo sem Docker, `npm run worker:local` sobe IA Notícias, recomendações e Shop. A moderação precisa do serviço Python, então só entra com `MODERATION=on` e o `moderator` rodando.

O CMS mostra o estado da IA em **IA Notícias**. A geração só acontece com o PC ligado: os pedidos ficam na fila do banco e são processados quando a IA local volta.

### Iniciar junto com o Windows

```powershell
# na pasta hypeverso-api (PowerShell)
.\scripts\windows\instalar-inicio-automatico.ps1                    # IA via Docker
.\scripts\windows\instalar-inicio-automatico.ps1 -ComCms             # IA + CMS (http://localhost:3001)
.\scripts\windows\instalar-inicio-automatico.ps1 -Modo nativo        # Ollama do Windows, sem Docker
```

O script cria tarefas no Agendador de Tarefas ("Hypeverso IA" e "Hypeverso CMS") que rodam 90 s depois do login, sem abrir janela. Os logs ficam em `logs/`. No modo Docker, ative em Docker Desktop › Settings › General a opção **Start Docker Desktop when you sign in**. Para remover: `.\scripts\windows\remover-inicio-automatico.ps1`.

### Backup do MySQL

O serviço `mysql-backup` (no `docker-compose.local-ai.yml`) faz uma cópia ao subir e depois todo dia às 3h. Os arquivos ficam em `backups/hypeverso-AAAA-MM-DD_HHMM.sql.gz`, mantidos por 30 dias (`BACKUP_KEEP_DAYS`, `BACKUP_HOUR` no `.env.worker`). Backup na hora: `npm run backup`. Para restaurar, veja `scripts/restaurar-backup.md`.

## 4. Testar tudo no PC antes de publicar

```bash
docker compose -f docker-compose.local-ai.yml -f docker-compose.dev.yml up -d --build
```

Sobe o MySQL local (porta 3307), a API (http://localhost:4000) e a IA. Depois rode o site e o CMS com `API_INTERNAL_URL=http://localhost:4000`.

## 5. Shop e configurações

- `GET /api/shop/products` lista os produtos ativos.
- `GET /api/shop/go/:id` conta o clique (1 por visitante a cada 30 min) e redireciona para a loja.
- `GET/POST/PATCH/DELETE /api/admin/shop/products` é o CRUD do CMS. O produto tem `highlights` (lista de destaques).
- `GET /api/shop/products?ids=a,b` devolve produtos para artigos (código `[[produto:slug]]`).
- `GET /api/shop/go/:id?src=/post/slug` guarda a página de origem do clique para o relatório.
- `GET /api/shop/collections/:slug` e `/api/admin/shop/collections` são as coleções (filtros + produtos escolhidos à mão).
- `GET /api/admin/shop/report?days=30` traz cliques por dia, loja, produto e página de origem.
- `POST /api/admin/shop/products/:id/check-result` e `GET …/history` cuidam da verificação e do histórico de preço.
- `GET /api/admin/media/moderation` e `POST /api/admin/media/:id/approve|reject` são a fila de moderação de imagens.
- `GET /api/settings/public` devolve os textos da Shop e a tag da Amazon para o site.
- `GET /api/admin/settings` e `PUT /api/admin/settings/:key` (`affiliate`, `shop`, `ai`, `moderation`) guardam as configurações do CMS.

A leitura da página da loja, as fotos e os textos da IA são feitos **no CMS**, no seu PC. Lá o IP é residencial (as lojas bloqueiam menos) e o Ollama está disponível.

## 6. Testes

```bash
npm run typecheck
npm test                 # unitários (Shop, cache em memória, gateway, configurações, 2FA…)
npm run test:integration # MySQL real via Testcontainers (precisa de Docker)
```
