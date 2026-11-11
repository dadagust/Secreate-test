---
id: TASK-007
title: Повысить пропускную способность доставки и восстановить полноту приёмки
status: Done
assignee: []
created_date: '2026-11-11 12:51'
updated_date: '2026-11-11 14:13'
labels: []
dependencies:
  - TASK-006
priority: high
type: enhancement
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Увеличить производительность фоновой доставки в штатном режиме без брокера, измерить ограничения worker и эмулятора, сделать демозагрузку возобновляемой и устранить пробелы повторной приёмки по docs/specs/04-system-integration.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 DeliveryWorker обрабатывает ограниченную пачку доступных записей за цикл, не захватывая больше записей, чем может обслужить; пустая очередь не создаёт быстрого опроса; PostgreSQL SKIP LOCKED, короткие транзакции, HTTP вне транзакций, lease, operationId и backoff сохранены.
- [x] #2 Раздельные измерения времени захвата outbox, HTTP эмулятора и локального применения выявляют либо исключают блокировку fault_modes; одноразовые режимы остаются атомарными, повтор operationId не создаёт второй внешний эффект.
- [x] #3 NF08 повторён на 5000 фикстурах, 20 последовательных клиентах, 30 секунд прогрева, 120 секунд измерения, четырёх операциях и подтверждённых лимитах 2 CPU / 4 GiB; сохранены раздельные счётчики прогрева и измерения, очередь до и после и окно drain до 120 секунд.
- [x] #4 Отчёт сравнивает стандартную конфигурацию до и после, включает p95 и размер выборки внешнего исполнения, ошибки/таймауты, валидность бизнес-операций и метрики пропускной способности; раннер сохраняет JSON, но завершает прогон ошибкой при пустой выборке или массовых бизнес-отказах.
- [x] #5 Seed чистого Compose, повторный запуск и прерывание после создания обычного задания проверены: повтор доводит восстанавливаемые шаги до конца с теми же ID; обязательные состояния проверяются, пользовательские изменения не перезаписываются и небезопасное состояние даёт понятную ошибку.
- [x] #6 Документы архитектуры, README, конфигурация, Linux-команды чистого ZIP, acceptance.md, performance.md и источник Project Overview согласованы с реализованным поведением; Markdown и HTML обзора пересобраны.
- [x] #7 На PostgreSQL проходят регрессии конкурентного захвата, потери ответа, истёкшего lease, рестартов, дубликатов, конфликтов и executions=1; lifecycle, чистый Docker smoke, NF08 и check:agents выполнены, TASK и WORKLOG отражают только фактические результаты.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# TASK-007 Implementation Plan

Goal: увеличенная пропускная способность штатной доставки и закрытые измерительные/демо-пробелы без брокера.

Architecture: bounded sequential batches in DeliveryWorker; PostgreSQL claims and apply remain short transactions; HTTP remains outside transactions; emulator instrumentation determines whether one-shot mode locking needs a CAS change.

Tech stack: Java 21, Spring Boot, JDBC/PostgreSQL, Docker Compose, Node.js, Bash and PowerShell.

Spec: docs/specs/04-system-integration.md; current evidence: docs/project/acceptance.md, docs/project/performance.md and saved docs/project/nf08*.json.

Constraints: preserve operationId, SKIP LOCKED, lease-token checks, bounded retry/backoff, duplicate/conflict semantics and existing working-tree changes; no broker, commit or push.

Step 1: inspect backend/src/main/java/ru/secreate/exchange/DeliveryWorker.java, ExchangeService.java, emulator/EmulatorMain.java and FaultModeStore.java; add phase timings for claim, HTTP, apply, connection and fault-mode consumption, then capture a 1000 ms baseline.

Step 2: add PostgreSQL regressions in backend/src/test/java/ru/secreate/exchange/DeliveryTest.java for bounded ticks, concurrent SKIP LOCKED claims, leases, duplicate/conflicting results and one-shot fault-mode consumption.

Step 3: implement configurable max items per DeliveryWorker tick in application.properties and DeliveryWorker.java, claiming only immediately before each synchronous send; keep the existing fixed delay when the queue is empty.

Step 4: evaluate emulator phase timings; only replace the common FOR UPDATE path if measurements show material contention, and preserve atomic compare-and-set consumption of one-shot faults and the unique executor ledger.

Step 5: harden scripts/performance/nf08-load.mjs and count helpers to separate warm-up/measurement creates, queue snapshots, rates, latency sample counts and rejected business operations; always save JSON and fail invalid/empty profiles.

Step 6: repeat standard NF08 at 1000 ms with 5000 fixtures, 20 sequential clients, 30s warm-up, 120s measurement and up to 120s drain; record queue and rate numbers, p95 and external p95 sample count before/after in docs/project/performance.md.

Step 7: make scripts/demo-seed.mjs and docker-up scripts resume stable steps, assert required final states and audit, preserve user edits, and fail clearly on conflicting existing state; test fresh, repeat and interruption cases.

Step 8: update docs/project/architecture.md, README.md, configuration.md, acceptance.md, performance.md and overview-source.txt; regenerate PROJECT_OVERVIEW.md and PROJECT_OVERVIEW.html; document Linux commands from a clean ZIP.

Step 9: run Maven verify/Testcontainers, affected frontend checks, Docker smoke, both lifecycle scripts, standard NF08 and npm run check:agents; review diff and record only verified outcomes in TASK-007 and WORKLOG.md.
<!-- SECTION:PLAN:END -->

## Результаты и подтверждения (2026-11-11)

- **Worker:** штатный `EXCHANGE_WORKER_MAX_ITEMS_PER_TICK=16`, последовательная отправка с захватом непосредственно перед каждым запросом и обычный fixed delay 1000 мс. PostgreSQL `DeliveryTest` проверяет ограниченный тик; `./mvnw -B -ntp verify` в Linux backend-check контейнере с Testcontainers прошёл: 31 тест, 0 failures/errors/skips.
- **Причина и решение по пропускной способности:** baseline batch=1 принял 785 заданий измерения (6.542/с), но после дополнительного окна фактической длительностью 123.5 с оставил 735 заданий. Установленная причина — один `deliverOne()` за цикл плюс 1000 мс fixed delay. В штатном batch=16 прогоне принято 783 (6.525/с); на границе ещё ожидали 409, после 57.005 с drain внешне исполнены 783/783, очередь и локально незавершённые операции равны 0. API p95 после: чтения 1198.2 мс, изменения 1283.1 мс; 3126 запросов успешны, ошибок/таймаутов/валидных бизнес-отказов нет. Цель drain за прежнее 120-секундное окно выполнена; это инженерная цель, не отдельный порог спеки.
- **Фазы:** после batch change p95: claim 100.906 мс, HTTP 193.001 мс, apply 100.065 мс; эмулятор connection 50.855 мс, `fault_modes FOR UPDATE` 2.700 мс, executor transaction 12.050 мс. Общая блокировка не была подтверждённым узким местом, поэтому её атомарность не менялась и параллельность не добавлялась. Внешний p95 — 61.115 с, выборка 783; спекового порога для этой задержки нет.
- **Валидность и артефакты NF08:** 5000 фикстур, 20 последовательных клиентов, 30 с прогрева, 120 с измерения, 4 операции, обычный режим, 2 CPU/4 GiB. Before/after отчёты сохранены в `docs/project/nf08-task007-before-batch-2026-11-11.json` и `docs/project/nf08-task007-after-batch-2026-11-11.json`. `node --test scripts/performance/*test.mjs`: 10/10; проверки требуют непустые API/external/timing выборки и отказывают при массовых бизнес-отказах, сохраняя JSON.
- **Seed:** на уникальном `task007-resume-360bb5df` тестовое прерывание после создания обычной задачи, но до назначения/аудита, затем два запуска `scripts/docker-up.ps1` восстановили назначение и audit с прежним UUID. Итог БД: семь демозадач, шесть `SUCCEEDED` с одной внешней записью каждая, одна `FAILED/PENDING` задача в операторских проблемах, одна запись назначения/аудита; дублей нет. Тестовый проект и его том удалены.
- **Linux lifecycle:** `docker run --name task007-lifecycle-final-2 -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD:/workspace" -w /workspace -e TASK004_RUNNER_IN_COMPOSE_NETWORK=1 task007-nf08-runner bash scripts/check-task004.sh` завершился кодом 0 в Linux-контейнере Docker Desktop/WSL2. Backend restart с активным lease и PostgreSQL restart с тем же томом сохранили историю/аудит; независимые GET подтвердили `executions=1`. Сценарий удалил только созданный им Compose project/volume. Нативный Linux-хост не использовался.
- **Документы:** актуализированы README, архитектура, конфигурация, acceptance/performance, quality checks и overview source. README вызывает Linux-скрипты через Bash. `npm run overview:build` пересоздал `PROJECT_OVERVIEW.md` и `PROJECT_OVERVIEW.html`; генератор не анализирует код автоматически.
- **Итоговые проверки:** Maven `verify` — 31/31; performance Node tests — 10/10; `npm run check:agents` — 561/561 тестов, skills sync 16/16, `overview:check` прошёл для Markdown и HTML, VitePress build прошёл. Все результаты относятся к этому локальному дереву и Docker Desktop/WSL2.
