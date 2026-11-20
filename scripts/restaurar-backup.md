# Restaurar um backup do MySQL

Os backups ficam em `hypeverso-api/backups/hypeverso-AAAA-MM-DD_HHMM.sql.gz` (inclui as imagens, que estão no banco).

**Pelo phpMyAdmin (hPanel):** descompacte o `.sql.gz` (7-Zip) e use Importar. Arquivos grandes podem passar do limite de upload; nesse caso use a opção abaixo.

**Pelo seu PC (Docker):**

```bash
gunzip -c backups/hypeverso-2026-11-20_0300.sql.gz | docker run -i --rm mariadb:11.4 \
  mariadb -h HOST_REMOTO -u USUARIO -pSENHA NOME_DO_BANCO
```

Para testar sem mexer no site, restaure no MySQL do ambiente de testes (`docker-compose.dev.yml`, porta 3307).
