#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
for command in docker node npm java curl setsid; do command -v "$command" >/dev/null || { echo "Не найден $command" >&2; exit 1; }; done
run_id=$(node -e "process.stdout.write(require('node:crypto').randomUUID().replaceAll('-',''))")
project="nf08-linux-$(date +%Y%m%d-%H%M%S)-${run_id:0:8}"
if [[ -n $(docker ps -aq --filter "label=com.docker.compose.project=$project") || -n $(docker volume ls -q --filter "label=com.docker.compose.project=$project") ]]; then
  echo "Проект $project уже существует; запуск отменён." >&2; exit 1
fi
compose=(docker compose -p "$project" -f compose.yaml -f compose.performance.yaml)
owned=0
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
      while IFS= read -r id; do [[ -z $id ]] || docker rm -f "$id" >&2 || true; done < <(docker ps -aq --filter "label=com.docker.compose.project=$project")
    fi
    if (( runner_attached )); then docker network disconnect "${project}_default" "$(hostname)" >&2 || true; fi
    "${compose[@]}" down --volumes --remove-orphans >&2 || true
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
read -r POSTGRES_PUBLISHED_PORT NF08_API_PUBLISHED_PORT NF08_EMULATOR_PUBLISHED_PORT < <(node --input-type=module -e 'import net from "node:net"; const servers = await Promise.all(Array.from({length:3},()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>resolve(s))}))); console.log(servers.map(s=>s.address().port).join(" ")); servers.forEach(s=>s.close());')
export POSTGRES_PUBLISHED_PORT NF08_API_PUBLISHED_PORT NF08_EMULATOR_PUBLISHED_PORT
export NF08_WORKER_POLL_MS=${NF08_WORKER_POLL_MS:-1000}
if [[ ! $NF08_WORKER_POLL_MS =~ ^[0-9]+$ ]] || (( NF08_WORKER_POLL_MS < 1 )); then echo 'Некорректный NF08_WORKER_POLL_MS' >&2; exit 2; fi
export NF08_WORKER_MAX_ITEMS_PER_TICK=${NF08_WORKER_MAX_ITEMS_PER_TICK:-16}
if [[ ! $NF08_WORKER_MAX_ITEMS_PER_TICK =~ ^[0-9]+$ ]] || (( NF08_WORKER_MAX_ITEMS_PER_TICK < 1 || NF08_WORKER_MAX_ITEMS_PER_TICK > 256 )); then echo 'Некорректный NF08_WORKER_MAX_ITEMS_PER_TICK' >&2; exit 2; fi
export NF08_MAX_BUSINESS_REJECTION_RATE=${NF08_MAX_BUSINESS_REJECTION_RATE:-0.01}
mkdir -p backend/target/performance
run_group bash -c 'cd "$1" && exec sh ./mvnw -B -ntp -DskipTests package dependency:copy-dependencies -DincludeScope=runtime -DoutputDirectory=target/dependency' _ "$root/backend"
owned=1
run_group "${compose[@]}" up -d --build --wait
if [[ ${NF08_RUNNER_IN_COMPOSE_NETWORK:-0} == 1 ]]; then
  docker network connect "${project}_default" "$(hostname)"
  runner_attached=1
  api='http://backend:8080'
  emulator='http://emulator:9090'
else
  api="http://127.0.0.1:$NF08_API_PUBLISHED_PORT"
  emulator="http://127.0.0.1:$NF08_EMULATOR_PUBLISHED_PORT"
fi
ready=0
for ((i=0;i<120;i++)); do
  if curl -fsS --max-time 2 -u alice:demo-alice "$api/api/tasks?status=SUCCEEDED&page=0" >/dev/null && curl -fsS --max-time 2 "$emulator/fault-modes" >/dev/null; then ready=1; break; fi
  sleep 1
done
if (( !ready )); then echo 'API или эмулятор не готовы.' >&2; exit 1; fi
curl -fsS --max-time 5 -X DELETE "$emulator/fault-modes" >/dev/null
faults=$(curl -fsS --max-time 5 "$emulator/fault-modes")
node -e 'const v=JSON.parse(process.argv[1]); if(v.unavailable || v.dropAfterSave || v.duplicateResult || v.delayMs!==0) process.exit(1)' "$faults"
limits_file="backend/target/performance/nf08-limits-$run_id.tsv"
: > "$limits_file"
total_cpu=0; total_memory=0
for service in postgres backend emulator; do
  container=$("${compose[@]}" ps -q "$service")
  IFS='|' read -r cpu memory <<< "$(docker inspect --format '{{.HostConfig.NanoCpus}}|{{.HostConfig.Memory}}' "$container")"
  read -r quota period <<< "$(docker exec "$container" cat /sys/fs/cgroup/cpu.max | tr -d '\r')"
  cgroup_memory=$(docker exec "$container" cat /sys/fs/cgroup/memory.max | tr -d '\r')
  if [[ ! $cpu =~ ^[0-9]+$ || ! $memory =~ ^[0-9]+$ || ! $quota =~ ^[0-9]+$ || ! $period =~ ^[0-9]+$ || ! $cgroup_memory =~ ^[0-9]+$ ]]; then echo "Неверные cgroup лимиты $service" >&2; exit 1; fi
  if (( cpu <= 0 || memory <= 0 || period <= 0 || cpu != quota * 1000000000 / period || memory != cgroup_memory )); then echo "Несовпадение лимитов $service" >&2; exit 1; fi
  total_cpu=$((total_cpu+cpu)); total_memory=$((total_memory+memory))
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$service" "$cpu" "$memory" "$quota" "$period" "$cgroup_memory" >> "$limits_file"
done
if (( total_cpu > 2000000000 || total_memory > 4294967296 )); then echo 'Общий лимит ресурсов превышен.' >&2; exit 1; fi
postgres=$("${compose[@]}" ps -q postgres)
actual_poll=$(docker exec "$("${compose[@]}" ps -q backend)" printenv EXCHANGE_WORKER_FIXED_DELAY_MS | tr -d '\r')
if [[ $actual_poll != "$NF08_WORKER_POLL_MS" ]]; then echo "Интервал worker не применён: $actual_poll" >&2; exit 1; fi
actual_batch=$(docker exec "$(${compose[@]} ps -q backend)" printenv EXCHANGE_WORKER_MAX_ITEMS_PER_TICK | tr -d '\r')
if [[ $actual_batch != "$NF08_WORKER_MAX_ITEMS_PER_TICK" ]]; then echo "Размер пачки worker не применён: $actual_batch" >&2; exit 1; fi
fixture="$root/backend/target/performance/nf08-fixtures-$run_id.tsv"
run_group bash scripts/prepare-nf08.sh "$project" "$fixture"
export NF08_API_URL=$api NF08_PROJECT=$project NF08_POSTGRES_CONTAINER=$postgres NF08_RUN_ID=$run_id NF08_FIXTURE_FILE=$fixture
export NF08_DRAIN_SECONDS=${NF08_DRAIN_SECONDS:-120}
raw="$root/backend/target/performance/nf08-linux-load-$run_id.json"
report="$root/backend/target/performance/nf08-linux-report-$run_id.json"
load_status=0
run_group node scripts/performance/nf08-load.mjs --output "$raw" || load_status=$?
if [[ ! -s $raw ]]; then echo "Генератор не записал отчёт, код $load_status" >&2; if (( load_status == 0 )); then load_status=1; fi; exit "$load_status"; fi
export NF08_LIMITS_FILE="$root/$limits_file" NF08_REPORT_RAW=$raw NF08_REPORT_OUTPUT=$report
export NF08_DOCKER_VERSION="$(docker version --format '{{.Server.Version}}')" NF08_COMPOSE_VERSION="$(docker compose version --short)"
export NF08_DOCKER_INFO="$(docker info --format '{{.NCPU}}|{{.MemTotal}}')" NF08_JAVA_VERSION="$(docker exec "$("${compose[@]}" ps -q backend)" java -version 2>&1)"
export NF08_POSTGRES_VERSION="$(docker exec "$postgres" psql -U exchange -d exchange -Atc 'show server_version')"
export NF08_MAVEN_VERSION="$(cd backend && sh ./mvnw -version | sed -n '1p')" NF08_NPM_VERSION="$(npm --version)"
node --input-type=module -e 'import fs from "node:fs"; import os from "node:os"; const r=JSON.parse(fs.readFileSync(process.env.NF08_REPORT_RAW)); const limits=fs.readFileSync(process.env.NF08_LIMITS_FILE,"utf8").trim().split("\n").map(line=>{const [service,cpu,memory,quota,period,cgroupMemory]=line.split("\t");return {service,hostNanoCpus:Number(cpu),hostMemoryBytes:Number(memory),cgroupCpuMax:`${quota} ${period}`,cgroupMemoryMaxBytes:Number(cgroupMemory)}}); r.environment={runId:process.env.NF08_RUN_ID,composeProject:process.env.NF08_PROJECT,platform:os.platform(),kernel:os.release(),node:process.version,npm:process.env.NF08_NPM_VERSION,maven:process.env.NF08_MAVEN_VERSION,springBoot:"4.1.2",docker:process.env.NF08_DOCKER_VERSION,compose:process.env.NF08_COMPOSE_VERSION,dockerEngineResources:process.env.NF08_DOCKER_INFO,java:process.env.NF08_JAVA_VERSION,postgres:process.env.NF08_POSTGRES_VERSION,workerPollIntervalMs:Number(process.env.NF08_WORKER_POLL_MS),workerMaxItemsPerTick:Number(process.env.NF08_WORKER_MAX_ITEMS_PER_TICK),maxBusinessRejectionRate:Number(process.env.NF08_MAX_BUSINESS_REJECTION_RATE),resourceLimits:limits,emulatorFaultModes:{unavailable:false,dropAfterSave:false,duplicateResult:false,delayMs:0},loadGenerator:"Node.js outside container quotas"}; fs.writeFileSync(process.env.NF08_REPORT_OUTPUT,JSON.stringify(r,null,2)+"\n");'
printf 'NF08 report: %s\n' "$report"
exit "$load_status"
