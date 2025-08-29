#!/usr/bin/env bash
set -Eeuo pipefail

# --- safety & prerequisites ---
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run as root (e.g., sudo bash start-xray-logger-agent.sh)" >&2
  exit 1
fi

# Ensure we can read from the terminal even when piped (curl | sudo bash)
if [[ ! -t 0 && -r /dev/tty ]]; then
  exec </dev/tty
fi

command -v docker >/dev/null 2>&1 || { echo "Error: docker is required."; exit 1; }
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "Error: Docker Compose not found (plugin or docker-compose)." >&2
  exit 1
fi

umask 077

DIR="/opt/xray-logger-agent"
RAW_BASE="https://raw.githubusercontent.com/likstanov/xray-logger/refs/heads/main/xray-logger-agent"

# --- helpers ---
set_env() {
  local key="$1" value="$2"
  # escape / and & for sed replacement
  local esc; esc="$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')"
  if [[ -f .env ]] && grep -Eq "^[[:space:]]*#?[[:space:]]*$key=" .env; then
    sed -i -E "s|^[[:space:]]*#?[[:space:]]*$key=.*|$key=$esc|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

ask_required() {
  # $1 = prompt, $2 = varname
  local prompt="$1" varname="$2" reply=""
  while :; do
    echo "$prompt"
    IFS= read -r reply || true
    if [[ -n "${reply}" ]]; then
      printf -v "$varname" '%s' "$reply"
      return 0
    fi
    echo "Value cannot be empty. Please try again."
  done
}

# --- 1. Папка и переход ---
mkdir -p "$DIR"
cd "$DIR"

# --- 2. docker-compose.yml ---
curl -fsSL "$RAW_BASE/docker-compose.yml" -o docker-compose.yml

# --- 3. .env из примера ---
curl -fsSL "$RAW_BASE/.env.example" -o .env.example
cp -f .env.example .env
rm -f .env.example
chmod 600 .env || true

# --- 4–6. Запрос значений и запись в .env ---
ask_required "Enter the secret code you received when installing the xray-logger server:" ENCRYPTION_KEY_BASE64
set_env "ENCRYPTION_KEY_BASE64" "$ENCRYPTION_KEY_BASE64"

ask_required "Enter the path to access.log (example: /var/lib/marzban-node/access.log):" ACCESS_LOG_PATH
set_env "ACCESS_LOG_PATH" "$ACCESS_LOG_PATH"

ask_required "Enter the API URL (example: http://78.222.213.55:8080 or https://xraylogger.domain.com):" API_URL
set_env "API_URL" "$API_URL"

ask_required "Enter the Node name (example: Netherlands-1):" NODE_NAME
set_env "NODE_NAME" "$NODE_NAME"

# --- 7. Старт контейнера ---
$COMPOSE_CMD up -d

# --- 8. Финальное сообщение ---
echo "xray-logger-agent started!"
