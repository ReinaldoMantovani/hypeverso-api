# NEXVERSE V17 — BullMQ Community / Open Source

Esta versão migra os processamentos assíncronos críticos do NEXVERSE para BullMQ Community, usando o Redis self-hosted que já existe no projeto. Nenhum recurso BullMQ Pro é utilizado.

## Filas

- `nexverse-ai-news`: geração de rascunhos do AI News Studio.
- `nexverse-system`: publicações agendadas, lembretes do Media Hub, notificações de nova notícia e sincronização pontual do Meilisearch.
- `nexverse-discovery`: embeddings locais e reconciliação completa do índice de busca.

## Confiabilidade

- tentativas automáticas com backoff exponencial;
- persistência dos jobs no Redis AOF;
- Redis configurado com `maxmemory-policy noeviction`;
- reconciliação periódica de AiNewsJob PENDING com BullMQ;
- cancelamento/exclusão continua registrado no PostgreSQL;
- jobs de conteúdo mantêm o PostgreSQL como fonte de verdade;
- filas podem ser pausadas e retomadas pelo painel administrativo.

## Painel

Acesse `/admin/filas` com usuário ADMIN.

O painel mostra:

- aguardando;
- ativos;
- falhos;
- concluídos;
- pausa/retomada;
- retry manual de jobs falhos;
- remoção de jobs falhos;
- limpeza em lote de falhas.

## Variáveis

```env
BULLMQ_ENABLED=true
BULLMQ_PREFIX=nexverse
BULLMQ_AI_NEWS_ATTEMPTS=3
BULLMQ_BACKOFF_MS=5000
BULLMQ_SYSTEM_CONCURRENCY=5
BULLMQ_AI_CONCURRENCY=1
BULLMQ_DISCOVERY_CONCURRENCY=1
QUEUE_WORKER_HEALTH_PORT=4030
```

## Workers

- `ai-worker`: consome `nexverse-ai-news`.
- `queue-worker`: consome `nexverse-system`.
- `discovery-worker`: consome `nexverse-discovery`.

A API principal apenas produz jobs; tarefas pesadas não bloqueiam requests HTTP.

## Diagnóstico

```powershell
.\scripts\diagnose-queues.ps1
```

ou manualmente:

```powershell
docker compose ps
docker compose logs ai-worker --tail 100
docker compose logs queue-worker --tail 100
docker compose logs discovery-worker --tail 100
docker compose exec redis redis-cli CONFIG GET maxmemory-policy
```

O valor esperado para `maxmemory-policy` é `noeviction`.
