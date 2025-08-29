#!/usr/bin/env bash
set -Eeuo pipefail

DIR="/opt/xray-logger-agent"
RAW_BASE="https://raw.githubusercontent.com/likstanov/xray-logger/refs/heads/main/xray-logger-agent"

# --- helpers ---
set_env() {
  local key="$1"
  local value="$2"
  local esc
  esc="$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')"
  if grep -Eq "^[[:space:]]*#?[[:space:]]*$key=" .env; then
    sed -i -E "s|^[[:space:]]*#?[[:space:]]*$key=.*|$key=$esc|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Error: $1 is required."; exit 1; }; }

# --- prerequisites ---
need_cmd curl
need_cmd docker

# Determine docker compose command
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "Error: Docker Compose not found. Install Docker Compose (plugin or docker-compose)." >&2
  exit 1
fi

# 1. Create folder and enter it
sudo mkdir -p "$DIR"
cd "$DIR"

# 2. Download docker-compose.yml
curl -fsSL "$RAW_BASE/docker-compose.yml" -o docker-compose.yml

# 3. Download .env.example, copy to .env, remove example
curl -fsSL "$RAW_BASE/.env.example" -o .env.example
cp -f .env.example .env
rm -f .env.example
chmod 600 .env || true

# 4. Ask for secret code -> ENCRYPTION_KEY_BASE64
echo "Enter the secret code you received when installing the xray-logger server:"
read -r ENCRYPTION_KEY_BASE64
set_env "ENCRYPTION_KEY_BASE64" "$ENCRYPTION_KEY_BASE64"

# 5. Ask for access.log path -> ACCESS_LOG_PATH
echo "Enter the path to access.log (example: /var/lib/marzban-node/access.log):"
read -r ACCESS_LOG_PATH
set_env "ACCESS_LOG_PATH" "$ACCESS_LOG_PATH"

# 6a. Ask for API URL -> API_URL
echo "Enter the API URL (example: http://78.222.213.55:8080 or https://xraylogger.domain.com):"
read -r API_URL
set_env "API_URL" "$API_URL"

# 6b. Ask for Node name -> NODE_NAME
echo "Enter the Node name (example: Netherlands-1):"
read -r NODE_NAME
set_env "NODE_NAME" "$NODE_NAME"

# 7. Start container
$COMPOSE_CMD up -d

# 8. Final message
echo "xray-logger-agent started!"
