#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backend=${BACKEND_DIR:-"$root/backend"}
cd "$backend"
export EXECUTOR_DB_URL=${EXECUTOR_DB_URL:-jdbc:postgresql://localhost:5432/exchange}
export EXECUTOR_DB_USER=${EXECUTOR_DB_USER:-exchange}
export EXECUTOR_DB_PASSWORD=${EXECUTOR_DB_PASSWORD:-local-demo-only}
sh ./mvnw -B -ntp compile dependency:build-classpath '-Dmdep.outputFile=target/classpath.txt'
classpath=$(cat target/classpath.txt)
exec java -cp "target/classes:$classpath" ru.secreate.exchange.emulator.EmulatorMain "${EXECUTOR_PORT:-9090}"
