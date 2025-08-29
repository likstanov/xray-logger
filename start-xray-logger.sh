#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/xray-logger"
RAW_BASE="https://raw.githubusercontent.com/likstanov/xray-logger/refs/heads/main/xray-logger"

# 1) Папка и переход
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 2) docker-compose.yml
curl -fsSL -o docker-compose.yml "$RAW_BASE/docker-compose.yml"

# 3) .env из .env.example
curl -fsSL -o .env.example "$RAW_BASE/.env.example"
cp .env.example .env && rm -f .env.example

# 4) Генерация секретов и замена значений в .env
ENC="$(openssl rand -base64 32 | tr -d '\n')"
PGPASS="$(openssl rand -base64 32 | tr -d '\n')"

grep -q '^ENCRYPTION_KEY_BASE64=' .env \
  && sed -i "s|^ENCRYPTION_KEY_BASE64=.*|ENCRYPTION_KEY_BASE64=$ENC|" .env \
  || echo "ENCRYPTION_KEY_BASE64=$ENC" >> .env

grep -q '^PGPASSWORD=' .env \
  && sed -i "s|^PGPASSWORD=.*|PGPASSWORD=$PGPASS|" .env \
  || echo "PGPASSWORD=$PGPASS" >> .env

# 5) Запуск контейнеров
if docker compose version >/dev/null 2>&1; then
  # Подхватим переменные окружения для надёжности
  set -a; . ./.env; set +a
  docker compose up -d
elif command -v docker-compose >/dev/null 2>&1; then
  set -a; . ./.env; set +a
  docker-compose up -d
else
  echo "Docker Compose не найден. Установите docker и docker compose." >&2
  exit 1
fi

# 6) Вывод данных для Adminer и ключа шифрования
PGHOST="$(sed -n 's/^PGHOST=\(.*\)/\1/p' .env)"
PGUSER="$(sed -n 's/^PGUSER=\(.*\)/\1/p' .env)"
PGPASSWORD_SHOW="$(sed -n 's/^PGPASSWORD=\(.*\)/\1/p' .env)"
PGDATABASE="$(sed -n 's/^PGDATABASE=\(.*\)/\1/p' .env)"
[ -z "${PGDATABASE:-}" ] && PGDATABASE="xray_logger"
ENC_SHOW="$(sed -n 's/^ENCRYPTION_KEY_BASE64=\(.*\)/\1/p' .env)"

cat <<EOF
xray-logger (server) started!
You should set up a proxy server for the Adminer.

Adminer host: $PGHOST
Adminer login: $PGUSER
Adminer password: $PGPASSWORD_SHOW
Adminer database: $PGDATABASE

You will need this secret code when installing the xray-logger-agent (to encrypt sending data from xray-logger agent to xray-logger):
$ENC_SHOW
EOF
