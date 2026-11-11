#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
for command in docker node curl setsid; do command -v "$command" >/dev/null || { echo "Не найден $command" >&2; exit 1; }; done
suffix=$(node -e "process.stdout.write(require('node:crypto').randomUUID().replaceAll('-','').slice(0,12))")
export COMPOSE_PROJECT_NAME="task004-linux-$suffix"
if [[ -n $(docker ps -aq --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME") || -n $(docker volume ls -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME") ]]; then
  echo 'Случайное имя проекта уже занято.' >&2; exit 1
fi
read -r APP_API_PORT APP_EMULATOR_PORT APP_FRONTEND_PORT < <(node --input-type=module -e 'import net from "node:net"; const servers=await Promise.all(Array.from({length:3},()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>resolve(s))})));console.log(servers.map(s=>s.address().port).join(" "));servers.forEach(s=>s.close())')
export APP_API_PORT APP_EMULATOR_PORT APP_FRONTEND_PORT
compose=(docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.app.yaml)
owned=1
child_pid=''
runner_attached=0
run_group() {
  local status=0
  setsid "$@" &
  child_pid=$!
  wait "$child_pid" || status=$?
  child_pid=''
  return "$status"
}
on_signal() {
  local status=$1
  trap - INT TERM
  if [[ -n $child_pid ]]; then
    kill -TERM -- "-$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
    child_pid=''
  fi
  exit "$status"
}
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if (( owned )); then
    if (( result )); then
      "${compose[@]}" logs --no-color --tail=150 >&2 || true
      while IFS= read -r id; do [[ -z $id ]] || docker rm -f "$id" >&2 || true; done < <(docker ps -aq --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME")
    fi
    if (( runner_attached )); then docker network disconnect "${COMPOSE_PROJECT_NAME}_default" "$(hostname)" >&2 || true; fi
    "${compose[@]}" down --volumes --remove-orphans >&2 || true
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
run_group sh scripts/docker-up.sh
if [[ ${TASK004_RUNNER_IN_COMPOSE_NETWORK:-0} == 1 ]]; then
  docker network connect "${COMPOSE_PROJECT_NAME}_default" "$(hostname)"
  runner_attached=1
  api='http://backend:8080'
  emulator='http://emulator:9090'
else
  api="http://127.0.0.1:$APP_API_PORT"
  emulator="http://127.0.0.1:$APP_EMULATOR_PORT"
fi
export EMULATOR_BASE_URL=$emulator
postgres=$("${compose[@]}" ps -q postgres)
query() { docker exec "$postgres" psql -U exchange -d exchange -v ON_ERROR_STOP=1 -A -t -c "$1" | tr -d '\r'; }
create_task() {
  local key
  key=$(node -e "process.stdout.write(require('node:crypto').randomUUID())")
  curl -fsS --max-time 5 -u alice:demo-alice -H 'Content-Type: application/json' -H "Idempotency-Key: $key" -d "{\"title\":\"TASK004 Linux $key\"}" "$api/api/tasks" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).id))'
}
wait_api() {
  for ((i=0;i<120;i++)); do
    if curl -fsS --max-time 2 -u alice:demo-alice "$api/api/tasks?page=0" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo 'Backend не готов после рестарта.' >&2; return 1
}
wait_done() {
  local id=$1 ready
  for ((i=0;i<450;i++)); do
    ready=$(query "select case when o.state='DONE' and t.status='SUCCEEDED' and o.attempts>=2 then 'yes' else 'no' end from tasks t join outbox o on o.task_id=t.id where t.id='$id'")
    if [[ $ready == yes ]]; then return 0; fi
    sleep .2
  done
  echo "Операция $id не восстановилась за 90 секунд." >&2; return 1
}
assert_external_one() {
  local actual
  actual=$(curl -fsS --max-time 5 "$emulator/operations/$1" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>process.stdout.write(String(JSON.parse(s).executions)))')
  [[ $actual == 1 ]] || { echo "Неверный executions=$actual для $1" >&2; return 1; }
}

# Эмулятор фиксирует результат до завершения задержанного ответа; убиваем backend с активным lease.
bash scripts/emulator-mode.sh DelayedResult 2400 >/dev/null
first=$(create_task)
[[ $first =~ ^[0-9a-f-]{36}$ ]] || { echo 'Некорректный UUID.' >&2; exit 1; }
captured=0
for ((i=0;i<150;i++)); do
  active=$(query "select case when state='READY' and lease_token is not null and lease_until>clock_timestamp() then 'yes' else 'no' end from outbox where task_id='$first'")
  if [[ $active == yes ]] && curl -fsS --max-time 1 "$emulator/operations/$first" >/dev/null 2>&1; then captured=1; break; fi
  sleep .1
done
if (( !captured )); then echo 'Не удалось увидеть внешний commit при активном lease.' >&2; exit 1; fi
assert_external_one "$first"
"${compose[@]}" kill backend
saved_lease=$(query "select lease_token::text || '|' || lease_until::text from outbox where task_id='$first'")
[[ -n $saved_lease ]] || { echo 'Lease не сохранился.' >&2; exit 1; }
"${compose[@]}" up -d --no-deps backend
wait_api
wait_done "$first"
assert_external_one "$first"
history_count=$(query "select count(*) from exchange_events where task_id='$first' and event in ('ATTEMPT_1','ATTEMPT_2')")
[[ $history_count == 2 ]] || { echo 'Нет истории двух попыток.' >&2; exit 1; }
curl -fsS --max-time 5 -u operator:demo-operator "$api/api/operator/tasks/$first" >/dev/null
echo "Backend restart: operationId=$first, сохранённый lease=$saved_lease, попытки >=2, executions=1"

# Остановка после потери ответа, перезапуск PostgreSQL с тем же томом и сравнение конкретных записей.
bash scripts/emulator-mode.sh DropAfterSave >/dev/null
second=$(create_task)
[[ $second =~ ^[0-9a-f-]{36}$ ]] || { echo 'Некорректный UUID.' >&2; exit 1; }
ambiguous=0
for ((i=0;i<150;i++)); do
  events=$(query "select count(*) from exchange_events where task_id='$second' and event='AMBIGUOUS_RETRY'")
  if (( events > 0 )); then ambiguous=1; break; fi
  sleep .1
done
if (( !ambiguous )); then echo 'Не зафиксирована потеря ответа.' >&2; exit 1; fi
"${compose[@]}" kill backend
assert_external_one "$second"
pending=$(query "select state from outbox where task_id='$second'")
[[ $pending == READY ]] || { echo "Повтор уже не ожидает: $pending" >&2; exit 1; }
first_history=$(query "select md5(string_agg(id::text || event || actor || created_at::text, '|' order by id)) from exchange_events where task_id='$first'")
second_history=$(query "select md5(string_agg(id::text || event || actor || created_at::text, '|' order by id)) from exchange_events where task_id='$second'")
audit=$(query "select md5(string_agg(a.id::text || a.actor || coalesce(a.old_assignee,'') || a.new_assignee || a.created_at::text, '|' order by a.id)) from assignment_audit a join tasks t on t.id=a.task_id where t.request_key='secreate-demo-v1-regular'")
[[ -n $first_history && -n $second_history && -n $audit ]] || { echo 'Нет истории или аудита до рестарта.' >&2; exit 1; }
volume=$(docker inspect --format '{{range .Mounts}}{{.Name}}{{end}}' "$postgres")
"${compose[@]}" restart postgres
for ((i=0;i<60;i++)); do if docker exec "$postgres" pg_isready -U exchange -d exchange >/dev/null 2>&1; then break; fi; sleep 1; done
[[ $(docker inspect --format '{{range .Mounts}}{{.Name}}{{end}}' "$postgres") == "$volume" ]] || { echo 'Том PostgreSQL изменился.' >&2; exit 1; }
[[ $(query "select md5(string_agg(id::text || event || actor || created_at::text, '|' order by id)) from exchange_events where task_id='$first'") == "$first_history" ]]
[[ $(query "select md5(string_agg(id::text || event || actor || created_at::text, '|' order by id)) from exchange_events where task_id='$second'") == "$second_history" ]]
[[ $(query "select md5(string_agg(a.id::text || a.actor || coalesce(a.old_assignee,'') || a.new_assignee || a.created_at::text, '|' order by a.id)) from assignment_audit a join tasks t on t.id=a.task_id where t.request_key='secreate-demo-v1-regular'") == "$audit" ]]
"${compose[@]}" up -d --no-deps backend
wait_api
wait_done "$second"
assert_external_one "$second"
curl -fsS --max-time 5 -u operator:demo-operator "$api/api/operator/tasks/$second" >/dev/null
echo "PostgreSQL restart: operationId=$second, том=$volume, история и аудит сохранены, executions=1"
