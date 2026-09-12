#!/bin/sh
# Jesse reads .env as a FILE via dotenv_values() when jesse.services.env is
# imported, not from environment variables. A missing or empty file ends in
# os._exit(1) with no useful message, so render it here from the environment.
set -eu

: "${JESSE_PASSWORD:?JESSE_PASSWORD is required: Jesse exits on an empty PASSWORD}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

PROJECT_DIR="${JESSE_PROJECT_DIR:-/app/jesse_project}"
ENV_FILE="$PROJECT_DIR/.env"

# Create the file private from the start instead of chmod-ing it afterwards.
umask 077
cat > "$ENV_FILE" <<EOF
PASSWORD=${JESSE_PASSWORD}
POSTGRES_HOST=${POSTGRES_HOST:-strategy_postgres}
POSTGRES_NAME=${POSTGRES_NAME:-jesse_db}
POSTGRES_PORT=${POSTGRES_PORT:-5432}
POSTGRES_USERNAME=${POSTGRES_USERNAME:-jesse_user}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
REDIS_HOST=${REDIS_HOST:-strategy_redis}
REDIS_PORT=${REDIS_PORT:-6379}
REDIS_PASSWORD=${REDIS_PASSWORD:-}
REDIS_DB=${REDIS_DB:-0}
APP_PORT=8000
IS_DEV_ENV=${IS_DEV_ENV:-FALSE}
EOF

cd "$PROJECT_DIR"
exec "$@"
