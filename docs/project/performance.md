# NF08: нагрузочная проверка и финальная приёмка

Результаты итогового прогона от 11 ноября 2026 г. Источник требований: `docs/specs/04-system-integration.md`, NF08, разделы 7 и 10. Команда создала временный Compose project и чистый PostgreSQL volume; после успешного отчёта она удалила только этот проект и том.

## Воспроизведение

Из корня репозитория в PowerShell с Java 21, Node.js и Docker Compose:

```powershell
$env:JAVA_HOME = '<путь-к-Java-21>'
& .\scripts\run-nf08.ps1 -DrainSeconds 120
```

Раннер собирает backend и runtime-зависимости Maven Wrapper, поднимает PostgreSQL, API и эмулятор, ждёт их готовности, сбрасывает и проверяет режимы сбоев, проверяет фактические квоты, вызывает `scripts/prepare-nf08.ps1`, затем запускает внешний Node.js генератор. Выбираются свободные loopback-порты и уникальное имя Compose project. Отчёт команды и исходный JSON сохраняются в игнорируемом `backend/target/performance/`.

Подготовку можно вызвать отдельно в уже запущенном проекте `compose.performance.yaml`:

```powershell
& .\scripts\prepare-nf08.ps1 -ProjectName <имя-nf08-проекта>
```

Она пересоздаёт только задания с `request_key` `nf08-fixture-*`, проверяет связанные строки и выгружает список фикстур. Создаётся 5000 записей: 2500 владельца Alice и 2500 Bob; у каждого владельца по 1250 статусов SUCCEEDED и FAILED. Все 5000 имеют состояние outbox DONE, три события истории, согласованную запись внешнего ledger с `executions=1`; `operator_scope` даёт оператору 2500 строк Alice и 0 строк Bob. Повторная подготовка очищает этот собственный префикс и создаёт полный набор заново. Демо-набор раздела 7 остаётся отдельным и содержит семь заданий.

## Среда и профиль

| Параметр | Значение итогового прогона |
| --- | --- |
| ОС хоста | Windows 11 Home Single Language |
| Ресурсы Docker Engine | 8 логических CPU, 33,187,655,680 байт памяти |
| Docker / Compose | 29.2.1 / 5.0.2 |
| Java в контейнерах / Spring Boot / Maven | Eclipse Temurin 21.0.13 / 4.1.2 / 3.10.0 |
| PostgreSQL | 17.11 (`postgres:17-alpine`) |
| Генератор нагрузки | Node.js 24.13.0, npm 11.6.2, процесс на хосте |
| Искусственные сбои | сброшены; `unavailable=false`, `dropAfterSave=false`, `duplicateResult=false`, `delayMs=0` |
| Прогрев / измерение | 30 секунд / 120 секунд |
| Клиенты | 20; у каждого только один незавершённый HTTP-запрос |
| Таймаут запроса | 5 секунд; включается в ошибки и p95, если срабатывает |
| Дополнительное ожидание доставки | до 120 секунд после границы измерения |
| Worker в perf Compose | polling interval 50 ms; бизнес-backoff повторов не меняется |

Генератор работал вне квот контейнеров; браузер во время профиля не запускался. В измерительной фазе каждый клиент после получения ответа начинал следующий запрос. Четыре операции чередовались равномерно: `GET /api/tasks?status=...&page=...` (страница по 20 записей), `GET /api/tasks/{id}`, `POST /api/tasks` и `PATCH /api/tasks/{id}/assignee`. Для POST использовались новые ключи и валидные инициаторы Alice/Bob; для PATCH — уникальные задания Alice и актуальная локальная версия от имени оператора.

## Проверенные квоты

Раннер сравнивает `docker inspect HostConfig.NanoCpus/Memory` и `/sys/fs/cgroup/cpu.max`, `memory.max` для каждого контейнера. Все значения совпали:

| Сервис | CPU | cgroup `cpu.max` | Память |
| --- | ---: | --- | ---: |
| Backend | 1.7 CPU | `170000 100000` | 2304 MiB |
| PostgreSQL | 0.2 CPU | `20000 100000` | 1536 MiB |
| Эмулятор | 0.1 CPU | `10000 100000` | 256 MiB |
| **Всего** | **2.0 CPU** | **2.0 CPU** | **4096 MiB (4 GiB)** |

Лимиты проверены в HostConfig и cgroup непосредственно перед измерением. Идентификаторы образов и фактические байтовые значения присутствуют в `backend/target/performance/nf08-report.json` для итогового запуска `dd3c2abfaa1849eba77ff3243ad9c2e8`.

## Результат

P95 рассчитан по времени round-trip от начала HTTP-запроса до получения его тела. Все завершённые запросы включены в p95; ошибок и таймаутов не было.

| Операция | Всего | Успешно | Ошибки | Таймауты | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| GET список | 812 | 812 (200) | 0 | 0 | 1182.9 ms |
| GET карточка | 814 | 814 (200) | 0 | 0 | 1108.3 ms |
| **Чтения вместе** | **1626** | **1626** | **0** | **0** | **1110.8 ms / лимит 2000 ms** |
| POST создание | 811 | 811 (200) | 0 | 0 | 1201.0 ms |
| PATCH ответственного | 810 | 810 (200) | 0 | 0 | 1193.3 ms |
| **Изменения вместе** | **1621** | **1621** | **0** | **0** | **1197.4 ms / лимит 3000 ms** |
| **Всего в измерении** | **3247** | **3247** | **0** | **0** | — |

В каждом клиентском цикле порядок запросов продолжался после завершения предыдущего; фактические количества операций отличаются не более чем на две записи. Причины ошибок и HTTP-коды записываются отдельно; в итоговом прогоне все ответы были 200.

### Время до внешнего исполнения

Внешняя таблица `executor.executions` хранит `executed_at`, выставляемое PostgreSQL при первой фиксации операции. Измерение вычитает `tasks.created_at` из этой отметки в той же БД.

| Снимок | Принято через POST | Внешне исполнено | Незавершено |
| --- | ---: | ---: | ---: |
| На границе 120-секундного измерения | 811 | 372 | 440 |
| После дополнительного окна до 120 секунд | 811 | 811 | 0 |

Для всех 811 измерительных POST после дренирования: медиана от создания записи до внешней фиксации — 48.38 s, p95 — 63.30 s, среднее — 47.64 s. Время внешней доставки приводится отдельно и не включается в p95 локального HTTP API.

## Исправление превышения при первом прогоне

Первая попытка имела распределение CPU backend/PostgreSQL/эмулятор `0.75/1.0/0.25`. Чтения показали p95 2201 ms и превысили NF08; изменения — 2400 ms. `cpu.stat` backend после прогона показал throttling в 1624 из 2385 периодов. Postgres и эмулятор при этом оставались почти незагружены. CPU и память перераспределены в пользу backend при неизменной общей квоте 2 CPU/4 GiB; итоговый профиль выше прошёл пороги.

Во втором проходе API-пороги уже выполнялись, но фоновой обработчик с обычным односекундным polling не успевал за потоком создания и оставлял очередь. Для производительного Compose-профиля интервал polling стал настраиваемым и задан 50 ms; дедлайны `next_attempt` и ограниченный backoff неизменны. Итоговый прогон выполнил все 811 операций до конца дополнительного 120-секундного окна. Значения внешнего p95 здесь являются наблюдением профиля и отдельный нормативный порог для них в NF08 не задан.

## Сверка требований D01–D07 и D-NF01–03

| Требование | Реализация | Воспроизводимое подтверждение |
| --- | --- | --- |
| D01 | `ExchangeService.create`, PostgreSQL tasks/outbox, `DeliveryWorker` | `DeliveryTest.repeatedPostThroughHttp`, `emulatorFaultModesAreDeterministicAndRecoverable`; Maven `verify` |
| D02 | Контракт и версии в `integrations.md`, API в `api.md`, `ResultDecision` | Maven `verify`; `check:agents` проверяет сборку документации |
| D03 | Проверка lease и версии до атомарного применения, уникальный внешний ledger | `lateWorkerCannotApplyResultOrChangeOutbox`, `deliveryWorkerAppliesExactDuplicateBatchOnceOnPostgres`, `deliveryWorkerRejectsContradictorySameVersionBatchBeforeApplyOnPostgres`, `concurrentVersionsCannotRollBackNewResult`; Maven `verify` |
| D04 | PostgreSQL outbox, `next_attempt`, expiry lease и ограниченный backoff | `expiredLeaseAndLostReplyKeepSingleExternalExecution`, `expiredLastLeaseClearsTokenAndRecordsReason`; `scripts/check-task004.ps1` |
| D05 | Наблюдение, сохранение снимков, явное применение/409 и управляемый повтор | `invalidExternalSnapshotsHaveReasonAndCannotBeApplied`, `slowReconciliationDoesNotHoldDeliveryLocks`, `slowDecisionDoesNotHoldDeliveryLocks`; `test:browser` |
| D06 | Ролевой API и React UI с реальными данными | `operatorHistoryIsRoleAndScopeRestricted`, `registryFiltersBeforePaginationAndEnforcesScope`; browser smoke |
| D07 | `EmulatorMain`, `FaultModeStore`, PowerShell-команды режимов и независимый GET | `emulatorFaultModesAreDeterministicAndRecoverable`; `scripts/check-task004.ps1`; README показывает команды и `GET /operations/{operationId}` |
| D-NF01 | Сохранённый outbox и восстановление после backend/PostgreSQL restart | `scripts/check-task004.ps1`: перезапуск с тем же томом, сохранённая история, продолжение доставки |
| D-NF02 | Идемпотентный `operationId`, duplicate/stale guards и независимый счётчик | `expiredLeaseAndLostReplyKeepSingleExternalExecution`, две PostgreSQL-регрессии дубликатов; независимый emulator GET показывает `executions=1` |
| D-NF03 | Ограниченные повторы, отдельный REVIEW для некорректных/противоречивых ответов и история | `differentKeysCannotRescheduleTheSameFailure`, `invalidExternalSnapshotsHaveReasonAndCannotBeApplied`, тесты дубликатов; Maven `verify` |

## Сверка NF01–NF10 и разделов 7/10

| Требование | Реализация и доказательство |
| --- | --- |
| NF01 | Реальные React/Vite, Spring API и PostgreSQL; CRUD не заменён браузерными заглушками. `test:browser`, Maven `verify`. |
| NF02 | Роли INITIATOR/OPERATOR и `operator_scope`; проверки HTTP для чужого владельца и операторских действий: `operatorHistoryIsRoleAndScopeRestricted`, `registryFiltersBeforePaginationAndEnforcesScope`, `operatorCannotCreateTask`. |
| NF03 | Flyway-схема, транзакционные изменения/аудит; rollback regressions и PostgreSQL restart с тем же volume в `check-task004.ps1`. |
| NF04 | `Idempotency-Key`, хэш POST, `recovery_commands`; `repeatedPostThroughHttp`, `concurrentPostHasOneTaskAndOutbox`, `manualRecoveryAfterRepeatedConflictUsesNewKeyAndReplaysIdempotently`. |
| NF05 | `exchange_events`, `assignment_audit`, автор и время; `concurrentAssignmentChangesOnceAndAuditsOldAndNew`, `assignmentRollsBackWhenAuditCannotBeWritten`, lifecycle-проверка. |
| NF06 | Подписи, пустые/загрузочные состояния, keyboard flows и адаптивные состояния; `test:session`, `test:browser`, `test:task004` на 390 и 1440 px. |
| NF07 | PostgreSQL `timestamptz`, время решений по часам БД, `spring.jackson.time-zone=UTC`, UI явно отображает UTC; `registryFiltersBeforePaginationAndEnforcesScope` проверяет `created_at` с `Z`. Сроков и календарных границ в продукте нет. |
| NF08 | Фактический профиль, p95, ошибки, таймауты, внешнее время и объём незавершённых операций приведены выше. |
| NF09 | Чистая схема применяется Flyway при запуске; README содержит Compose, запуск API/UI/эмулятора, demo seed и профили проверки. `scripts/demo-seed.ps1`, `scripts/check-task004.ps1`. |
| NF10 | PostgreSQL Testcontainers, HTTP/конкурентные проверки, браузерные сценарии и диагностические события с operationId/attempt/outcome без паролей; `mvnw verify`, `check-task004.ps1`, `check:agents`. |
| Раздел 7 | Воспроизводимый `demo-seed.ps1` создаёт семь заданий двух инициаторов и демонстрирует разные исходы/четыре режима D07; проверяет успешное задание и операторскую проблему. `scripts/check-task004.ps1`. |
| Раздел 10 | Код, Flyway, Compose, фиктивные demo-данные, проверки и документация запуска/архитектуры/API/допущений/ограничений связаны из README и `docs/project/`. `mvnw verify`, frontend checks, lifecycle/browser и `check:agents`. |

## Известные ограничения

- Статический пользовательский каталог и локальные demo-пароли подходят только для демонстрации; области оператора отдельно не администрируются.
- В NF08 backend-профиль принудительно выставляет polling 50 ms; стандартный профиль приложения оставляет default 1000 ms. Внешнее время, полученное в этом отчёте, относится к указанной настройке и нагрузке, а не к production SLA.
- Даже с polling 50 ms 440 outbox-операций оставались незавершёнными непосредственно на границе измерения; все завершились в дополнительном окне 120 секунд. NF08 задаёт пороги только для локального API и не задаёт отдельный порог внешней доставки.
- Профиль выполняется на локальном Docker Desktop и не прогнозирует производственную ёмкость.
