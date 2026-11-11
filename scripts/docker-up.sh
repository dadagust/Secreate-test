#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
docker compose -f compose.app.yaml up -d --build --wait
docker compose -f compose.app.yaml run --rm --no-deps --build seed
printf '%s\n' 'Демо готово. Откройте http://127.0.0.1:5173/ или заданный APP_FRONTEND_PORT.'
