#!/usr/bin/env bash
# Reads answers from /dev/tty so prompts work even via: curl ... | sudo bash
set -u -o pipefail

require_root() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    echo "Please run as root (e.g., sudo bash start-xray-logger-agent.sh)" >&2
    exit 1
  fi
}
require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Error: $1 is required." >&2; exit 1; }; }

# Prompt helper that ALWAYS reads from the terminal
ask_required() {
  # $1=prompt  $2=varname
  local prompt="$1" varname="$2" reply=""
  while :; do
    # print to tty (not stdout) and read from tty so pipe won't break us
    printf '%s\n' "$prompt" > /dev/tty
    IFS= read -r reply < /dev/tty || reply=""
    if [ -n "$reply" ]; then
      printf -v "$varname" '%s' "$reply"
      return 0
    fi
    printf 'Value cannot be empty. Please try again.\n' > /dev/tty
  done
}

# Safely set or update KEY=VALUE in .env
set_env() {
  local key="$1" value="$2"
  # escape / and & for sed
  local esc; esc="$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')"
  if [ -f .env ] && grep -Eq "^[[:space:]]*#?[[:space:]]*$key=" .env; then
    sed -i -E "s|^[[:space:]]*#?[[:space:]]*$key=.*|$key=$esc|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

main() {
  require_root
  require_cmd curl
  require_cmd docker

  # Pick compose
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

  mkdir -p "$DIR"
  cd "$DIR"

  # Fetch files
  curl -fsSL "$RAW_BASE/docker-compose.yml" -o docker-compose.yml
  curl -fsSL "$RAW_BASE/.env.example" -o .env.example
  cp -f .env.example .env && rm -f .env.example
  chmod 600 .env || true

  # Prompts — read from /dev/tty
  ask_required "Enter the secret code you received when installing the xray-logger server:" ENCRYPTION_KEY_BASE64
  set_env "ENCRYPTION_KEY_BASE64" "$ENCRYPTION_KEY_BASE64"

  ask_required "Enter the path to access.log (example: /var/lib/marzban-node/access.log):" ACCESS_LOG_PATH
  set_env "ACCESS_LOG_PATH" "$ACCESS_LOG_PATH"

  ask_required "Enter the API URL (example: http://78.222.213.55:8080 or https://xraylogger.domain.com):" API_URL
  set_env "API_URL" "$API_URL"

  ask_required "Enter the Node name (example: Netherlands-1):" NODE_NAME
  set_env "NODE_NAME" "$NODE_NAME"

  # Start
  $COMPOSE_CMD up -d

  echo "xray-logger-agent started!"
}

main "$@"
