#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backend=${BACKEND_DIR:-"$root/backend"}
cd "$backend"
export SPRING_DATASOURCE_URL=${SPRING_DATASOURCE_URL:-jdbc:postgresql://localhost:5432/exchange}
export SPRING_DATASOURCE_USERNAME=${SPRING_DATASOURCE_USERNAME:-exchange}
export SPRING_DATASOURCE_PASSWORD=${SPRING_DATASOURCE_PASSWORD:-local-demo-only}
sh ./mvnw -B -ntp -DskipTests package
exec java -jar target/exchange-0.0.1-SNAPSHOT.jar
