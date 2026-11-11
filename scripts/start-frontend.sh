#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
frontend=${FRONTEND_DIR:-"$root/frontend"}
cd "$frontend"
exec node node_modules/vite/bin/vite.js --host 127.0.0.1 "$@"
