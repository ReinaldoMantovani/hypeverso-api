#!/bin/bash
# Backup do MySQL da Hostinger (roda no container mariadb, no seu PC).
# - Faz uma cópia ao iniciar (se ainda não houver uma de hoje) e depois todo dia em BACKUP_HOUR.
# - Arquivos: ./backups/hypeverso-AAAA-MM-DD_HHMM.sql.gz  · mantém BACKUP_KEEP_DAYS dias.
# - ONCE=1 faz uma única cópia e sai (usado por "npm run backup").
set -u
URL="${DATABASE_URL:-}"
if [[ -z "$URL" ]]; then echo "[backup] DATABASE_URL vazio; nada a fazer."; sleep infinity; fi
# mysql://usuario:senha@host:porta/banco?params
re='^mysql://([^:]+):([^@]*)@([^:/]+)(:([0-9]+))?/([^?]+)'
if [[ ! "$URL" =~ $re ]]; then echo "[backup] DATABASE_URL inválido"; exit 1; fi
USER_="${BASH_REMATCH[1]}"; PASS_RAW="${BASH_REMATCH[2]}"; HOST="${BASH_REMATCH[3]}"; PORT="${BASH_REMATCH[5]:-3306}"; DB="${BASH_REMATCH[6]}"
# Decodifica %XX da senha (caracteres especiais na URL).
PASS="$(printf '%b' "${PASS_RAW//%/\\x}")"
KEEP="${BACKUP_KEEP_DAYS:-30}"; HOUR="${BACKUP_HOUR:-3}"

backup() {
  local file="/backups/hypeverso-$(date +%F_%H%M).sql.gz"
  echo "[backup] iniciando $(date '+%F %T') → $file"
  if MYSQL_PWD="$PASS" mariadb-dump -h "$HOST" -P "$PORT" -u "$USER_" \
      --single-transaction --quick --routines --triggers --skip-lock-tables \
      --default-character-set=utf8mb4 --hex-blob "$DB" | gzip -9 > "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "[backup] ok ($(du -h "$file" | cut -f1))"
    find /backups -name 'hypeverso-*.sql.gz' -mtime +"$KEEP" -delete
  else
    rm -f "$file.tmp"; echo "[backup] FALHOU — confira o Remote MySQL (IP liberado) e a senha."
    return 1
  fi
}

mkdir -p /backups
if [[ "${ONCE:-0}" == "1" ]]; then backup; exit $?; fi
ls /backups/hypeverso-"$(date +%F)"_*.sql.gz >/dev/null 2>&1 || backup
while true; do
  now=$(date +%s); target=$(date -d "today ${HOUR}:00" +%s)
  (( target <= now )) && target=$(date -d "tomorrow ${HOUR}:00" +%s)
  sleep $(( target - now )); backup || true
done
