#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
project=${1:?Использование: prepare-nf08.sh nf08-PROJECT [OUTPUT_PATH]}
output=${2:-"$root/backend/target/performance/nf08-fixtures.tsv"}
if [[ ! $project =~ ^nf08-[a-z0-9-]+$ ]]; then
  echo 'Имя проекта должно начинаться с nf08- и содержать только строчные латинские буквы, цифры и дефис.' >&2
  exit 2
fi
cd "$root"
container=$(docker compose -p "$project" -f compose.yaml -f compose.performance.yaml ps -q postgres)
if [[ -z $container ]]; then echo 'PostgreSQL проекта не запущен.' >&2; exit 1; fi
docker exec -i "$container" psql -U exchange -d exchange -v ON_ERROR_STOP=1 < scripts/performance/seed-nf08.sql
query() { docker exec "$container" psql -U exchange -d exchange -v ON_ERROR_STOP=1 -A -t -F '|' -c "$1"; }
distribution=$(query "SELECT count(*) || '|' || count(*) FILTER (WHERE owner_name='alice') || '|' || count(*) FILTER (WHERE owner_name='bob') || '|' || count(*) FILTER (WHERE status='SUCCEEDED') || '|' || count(*) FILTER (WHERE status='FAILED') FROM tasks WHERE request_key LIKE 'nf08-fixture-%';")
if [[ $distribution != '5000|2500|2500|2500|2500' ]]; then echo "Неверное распределение: $distribution" >&2; exit 1; fi
integrity=$(query "SELECT count(*) || '|' || count(*) FILTER (WHERE o.state='DONE' AND o.attempts=1 AND o.lease_token IS NULL) || '|' || count(*) FILTER (WHERE e.executions=1 AND e.result_version=t.result_version AND e.result_status=t.status) || '|' || count(*) FILTER (WHERE event_count.total=3) || '|' || count(*) FILTER (WHERE s.operator_name='operator' AND s.owner_name='alice') || '|' || count(*) FILTER (WHERE t.owner_name='bob' AND s.operator_name='operator') FROM tasks t JOIN outbox o ON o.task_id=t.id JOIN executor.executions e ON e.id=t.id LEFT JOIN operator_scope s ON s.owner_name=t.owner_name AND s.operator_name='operator' LEFT JOIN (SELECT task_id, count(*) AS total FROM exchange_events GROUP BY task_id) event_count ON event_count.task_id=t.id WHERE t.request_key LIKE 'nf08-fixture-%';")
if [[ $integrity != '5000|5000|5000|5000|2500|0' ]]; then echo "Неверные связанные данные: $integrity" >&2; exit 1; fi
mkdir -p -- "$(dirname -- "$output")"
query "SELECT id, owner_name, title, status, local_version, assignee FROM tasks WHERE request_key LIKE 'nf08-fixture-%' ORDER BY owner_name, id;" > "$output"
if [[ $(wc -l < "$output") -ne 5000 ]]; then echo 'Выгружено не 5000 записей.' >&2; exit 1; fi
printf 'NF08 fixtures: %s; integrity: %s; file: %s\n' "$distribution" "$integrity" "$output"
