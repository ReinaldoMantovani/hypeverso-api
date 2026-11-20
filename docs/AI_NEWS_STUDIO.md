# AI News Studio

O AI News Studio pesquisa notícias recentes relacionadas às categorias cadastradas no NEXVERSE, cruza fontes, gera um texto editorial original, prepara SEO, procura imagens com licença compatível no Wikimedia Commons e cria o resultado sempre como `DRAFT`.

## Arquitetura resiliente

A geração pesada não roda mais no mesmo processo HTTP da API. O Docker Compose possui um serviço independente `ai-worker`.

```text
Web -> API -> PostgreSQL (fila AiNewsJob)
                  |
                  v
             ai-worker
              /     \
         SearXNG   Ollama
            |        |
       RSS fallback  artigo
            \        /
          fontes + imagens -> DRAFT
```

Isso evita que uma geração lenta, timeout de fonte ou falha do worker derrube login, CMS ou `/health`.

## Busca

1. SearXNG em `news,general`.
2. Segunda tentativa no SearXNG usando `general` quando há poucos resultados.
3. Fallback gratuito por RSS de notícias quando a busca primária falha ou retorna poucos resultados.
4. URLs duplicadas são removidas.
5. A leitura das fontes ocorre com concorrência limitada a 2 requisições para reduzir o tempo total sem sobrecarregar sites externos.

A aplicação não tenta contornar bloqueios de paywall ou proteções anti-bot. Quando uma fonte bloqueia leitura automatizada, somente o resumo já disponibilizado pelo mecanismo de busca/RSS pode ser usado.

## Ollama

O modelo recomendado para máquinas comuns é:

```text
qwen2.5:3b
```

Ele usa consideravelmente menos memória que o 7B. Em máquinas com RAM/GPU suficiente, `qwen2.5:7b` continua suportado via `OLLAMA_MODEL`.

A resposta do Ollama agora é recebida por streaming. O worker diferencia:

- timeout total da geração;
- ausência prolongada de dados;
- modelo não instalado;
- erro HTTP do Ollama;
- JSON inválido gerado pelo modelo.

O contexto padrão foi reduzido para 8192 tokens para evitar consumo excessivo de memória em máquinas locais.

## Instalação

Windows:

```powershell
.\scripts\setup-ai.ps1
```

Para usar o modelo 7B:

```powershell
.\scripts\setup-ai.ps1 -Model qwen2.5:7b
```

Linux/macOS:

```bash
./scripts/setup-ai.sh
```

## Variáveis

```env
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=qwen2.5:3b
SEARXNG_URL=http://searxng:8080
AI_NEWS_POLL_MS=5000
AI_NEWS_SOURCE_LIMIT=3
AI_NEWS_FETCH_TIMEOUT_MS=25000
AI_NEWS_SEARCH_TIMEOUT_MS=30000
AI_NEWS_FETCH_RETRIES=2
AI_NEWS_RSS_FALLBACK_ENABLED=true
AI_NEWS_LLM_TIMEOUT_MS=720000
AI_NEWS_LLM_IDLE_TIMEOUT_MS=180000
AI_NEWS_LLM_NUM_CTX=8192
AI_NEWS_LLM_NUM_PREDICT=3200
AI_NEWS_STALE_JOB_MS=1200000
```

No Compose a API recebe `AI_NEWS_WORKER_ENABLED=false`, enquanto `ai-worker` recebe `true`. Isso garante que só o worker separado consuma a fila.

## Diagnóstico

```powershell
docker compose ps
```

Os serviços esperados são `api`, `ai-worker`, `ollama`, `searxng`, `postgres`, `redis` e `web`.

Logs do worker:

```powershell
docker compose logs -f ai-worker
```

Logs da API:

```powershell
docker compose logs -f api
```

Modelos instalados:

```powershell
docker compose exec ollama ollama list
```

Teste rápido do Ollama:

```powershell
docker compose exec ollama ollama run qwen2.5:3b "Responda apenas OK"
```

## Recuperação automática

`AiNewsJob` agora registra tentativa, etapa, mensagem e heartbeat. Um job em `PROCESSING` sem heartbeat por tempo superior a `AI_NEWS_STALE_JOB_MS` volta para `PENDING` automaticamente.

As etapas exibidas no painel incluem:

- `SEARCHING`
- `SOURCES`
- `WRITING`
- `IMAGES`
- `SAVING`
- `COMPLETED`
- `FAILED`

## Publicação

A IA nunca publica automaticamente. Todo conteúdo criado por este fluxo é gravado como `DRAFT` para revisão humana antes de publicação/agendamento.
