# Повторная сверка спецификации

Источник требований — `docs/specs/04-system-integration.md`. Значения в строках требований включают сохранённые исторические прогоны. В повторной проверке 2026-11-11 `verify` в Java 21 контейнере с Testcontainers выполнил 33 теста без ошибок и пропусков; host-вызов `.\mvnw.cmd` не стартовал из-за некорректного `JAVA_HOME`. Frontend lint, `test:styles`, `test:session`, build, тесты NF08/seed 19/19, browser smoke и `test:task004` прошли. Browser и lifecycle запущены на изолированных Compose-проектах. Linux lifecycle выполнялся Linux-контейнером через Docker Desktop, а не на отдельном нативном Linux-хосте.

| Требование | Код и документы | Команда или тест и фактический результат |
| --- | --- | --- |
| D01 | `ExchangeService.create`, `DeliveryWorker`, outbox | Maven `verify`: `repeatedPostThroughHttp` и доставка на PostgreSQL прошли в составе 30 тестов. |
| D02 | `docs/project/integrations.md`, `ResultDecision`, `EmulatorMain` | Maven `verify` прошёл; `npm run check:agents` собрал документацию. |
| D03 | `DeliveryWorker`, `ExchangeService.complete`, внешний ledger | Maven `verify`: `deliveryWorkerAppliesExactDuplicateBatchOnceOnPostgres`, `deliveryWorkerRejectsContradictorySameVersionBatchBeforeApplyOnPostgres`, `concurrentVersionsCannotRollBackNewResult`, `completeRechecksLeaseAfterWaitingForTaskLock`, `contradictoryBatchRechecksLeaseAfterWaitingForTaskLock` прошли на PostgreSQL. |
| D04 | Outbox, lease и retry в `ExchangeService`; повторная проверка срока после блокировок | `completeRechecksLeaseAfterWaitingForTaskLock`, `contradictoryBatchRechecksLeaseAfterWaitingForTaskLock`, `finishRechecksLeaseAfterWaitingForOutboxLock`, `rejectRechecksLeaseAfterWaitingForOutboxLock` прошли в Maven `verify`; lifecycle из `bash scripts/check-task004.sh` сохраняет доставку после backend и PostgreSQL restart. |
| D05 | `ReconciliationService`, operator API | Maven `verify`: `invalidExternalSnapshotsHaveReasonAndCannotBeApplied`, `slowReconciliationDoesNotHoldDeliveryLocks`, `slowDecisionDoesNotHoldDeliveryLocks` прошли; Windows `test:browser` прошёл в Compose. |
| D06 | `OperatorApi`, `RegistryService`, React UI | Maven `verify`: `operatorHistoryIsRoleAndScopeRestricted`, `registryFiltersBeforePaginationAndEnforcesScope` прошли; Windows `test:browser` прошёл на 390/1440 px. |
| D07 | `EmulatorMain`, `FaultModeStore`, команды режимов | Linux `check-task004.sh` загрузил демо четырёх режимов и прошёл восстановление; `emulator-mode.sh` отдельно переключил все четыре режима и Reset. |
| D-NF01 | PostgreSQL outbox и lease | Linux `check-task004.sh` прошёл restart backend после внешнего commit и PostgreSQL с тем же томом. |
| D-NF02 | Уникальный `executor.executions`, проверка версий | Linux lifecycle подтвердил `executions=1` после обоих рестартов; Maven тесты дубликата и устаревшей версии прошли. |
| D-NF03 | Ограниченные повторы, REVIEW, история | Maven `verify`: `differentKeysCannotRescheduleTheSameFailure`, `invalidExternalSnapshotsHaveReasonAndCannotBeApplied` прошли; демо создало FAILED/PENDING проблему. |
| NF01 | `frontend/src`, `TaskApi`, PostgreSQL | Windows `test:browser` прошёл с полным Compose; данные получены через работающий API. |
| NF02 | `Security`, `operator_scope`, `RegistryService` | Maven `verify`: `operatorCannotCreateTask`, `operatorHistoryIsRoleAndScopeRestricted`, `registryFiltersBeforePaginationAndEnforcesScope` прошли. |
| NF03 | Миграции, транзакции Spring | Maven `verify`: `failureWhileWritingHistoryRollsBackResultAndOutbox`, `assignmentRollsBackWhenAuditCannotBeWritten` прошли; Linux lifecycle сохранил конкретные историю и аудит. |
| NF04 | Ключ создания и `recovery_commands` | Maven `verify`: `concurrentPostHasOneTaskAndOutbox`, `manualRecoveryAfterRepeatedConflictUsesNewKeyAndReplaysIdempotently` прошли. |
| NF05 | V8/V9 `exchange_events.details`, `assignment_audit`, `reconciliations`; `OperatorApi`, карточка оператора | Структурированные детали новых переходов записываются транзакционно и видны оператору в его области. V9 восстанавливает историю из ledger/snapshot/conflict/recovery sources. PostgreSQL `migrationBackfillsLegacyV7AuditTransitionDetailsFromStoredHistory` проверяет V7→V9: создание, попытки, повтор, применение, конфликт, сверку, решение и восстановление; без надёжного источника результат явно отмечается как недоступный без выдумывания. Ограничение запрещает новые пустые details. |
| NF06 | `frontend/src`, `frontend/src/styles` | Windows и Linux `test:browser` в Compose прошли клавиатурные сценарии на 390 и 1440 px; Linux `test:session` и обе платформы `test:task004` прошли. |
| NF07 | PostgreSQL `timestamptz`, Jackson UTC, frontend UTC | Maven `verify`: `registryFiltersBeforePaginationAndEnforcesScope` проверил представление UTC. Предметных сроков и границ периодов нет. |
| NF08 | `scripts/performance`, `DeliveryWorker`, `compose.performance.yaml` | Исторические прогоны TASK-007/TASK-008 сохранены ниже без перезаписи. Новый стандартный Linux-runner профиль 12.11.2026 после исправления audit seed: **3218/3218 HTTP 200**, 0 ошибок/таймаутов/бизнес-отказов; p95 чтений/изменений 1186,4/1207,9 мс. На границе 403/806 измерительных созданий исполнены, 403 локально незавершены; после 51,911 с drain 806/806 исполнены, очередь 0. Внешний p95 — 57 869,6 мс, n=806. Таблица, метод и JSON: [performance.md](performance.md), [JSON](nf08-task-001-03-2026-11-12.json). |
| NF09 | Flyway, `compose.app.yaml`, `scripts/docker-up.*`, `scripts/demo-seed.mjs` | Windows PowerShell и Linux-контейнер с Docker CLI подняли изолированные Compose project и семь демозаданий; повтор не создал дублей. Linux host-скрипты API, эмулятора, Vite и seed проверены в отдельных Linux-контейнерах с общей host-сетью и изолированной БД. |
| NF10 | Maven/Testcontainers, диагностика по operationId и попытке | Исторические Windows и Linux-container `verify`: 30/30; TASK-001.01 `verify`: 37/37; текущий `verify` в Java 21/Testcontainers PostgreSQL 17.11: 43/43. `check:agents`: 561/561; Linux lifecycle через Docker Desktop вывел operationId и подтвердил восстановление. Для Testcontainers внутри Docker Desktop требуется `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`. |
| Раздел 7 | `scripts/demo-seed.mjs`, `EmulatorMain` | Linux и Windows Docker-запуск создали семь заданий Alice/Bob, шесть успешных и одну проблему; повторный запуск сохранил семь записей. |
| Раздел 10 | Код, миграции, Compose, README и документы проекта | Исходный код, миграции, демоданные, проверки и документация присутствуют; Windows и Linux-контейнерные проверки и оба измеренных профиля приведены в этом отчёте. |

## Границы подтверждения

Локальные demo-учётные записи и область оператора фиксированы в конфигурации и миграции. Эмулятор и приложение используют разные схемы одного PostgreSQL; внешнее чтение при сверке и локальный commit не являются распределённой транзакцией. Batch=1 baseline при стандартных 1000 мс подтвердил старое узкое место: после дополнительного 120-секундного окна оставались 735 из 785 измерительных задач. Штатный batch=16 завершил все 783 измерительных задания за 57 секунд дополнительного окна; 1000 мс остаётся стандартом, а 50 мс — только исторической специальной конфигурацией. Инженерная цель полного drain не является отдельным нормативным порогом спецификации. Проверки TASK-007 отражены в `PROGRESS.md` и самой задаче.

## Повторная сверка 2026-11-11

Проверка JSON `docs/project/nf08-presale-2026-11-11.json` валидатором завершилась `passed=true`: 2547/2547 запросов успешны, ошибок и таймаутов нет; чтения p95 1504,2 мс, изменения p95 1595,2 мс. На границе измерения 394 задания были локально незавершёнными, внешне исполнены 244/638; после сохранённого drain в JSON очередь опустела и внешне исполнены 638/638. Это проверка сохранённого результата, не новый NF08-прогон.

`npm run check:agents` прошёл после обновления этого документа: 561 тест, skills синхронизированы, Markdown/HTML Project Overview актуальны, VitePress собран. На отдельном Compose project изолированный полный запуск создал семь заданий, API оператора вернул проблему, frontend ответил HTTP 200; `check-demo-seed.ps1` проверил чистый seed, повтор, восстановление после прерывания и неизменность пользовательской записи с совпадающим заголовком. В отдельном изолированном Compose-проекте Chrome browser smoke прошёл на ширинах 390 и 1440 px, `test:task004` подтвердил delayed/unavailable сценарии. `bash scripts/check-task004.sh` прошёл в Linux-контейнере с Docker Desktop; проверены рестарт backend/PostgreSQL, история и независимый `executions=1`. Эти Linux-результаты не являются запуском на нативном Linux-хосте.

Проверка NF05 от 2026-11-11 ниже фиксирует состояние на тот момент: V8 уже обеспечивал детали новых действий, но ещё не восстанавливал старые. Это ограничение закрывается отдельной миграцией V9 и тестом TASK-001.03, описанными в актуальной записи ниже.

## Повторная проверка TASK-001.02 — 2026-11-12

- PostgreSQL `mvnw verify` на смонтированном текущем рабочем дереве: **42 теста, 0 failures/errors/skipped, BUILD SUCCESS**. В отчёте Surefire присутствуют все четыре D04 lock-wait теста, проверка истечения lease в contradictory-batch и регрессия `contradictoryResultAuditIncludesActualDeliveryTransition`.
- Frontend lint, `test:styles`, `build` и `test:session` прошли. Session-тест проверил завершение busy-флагов после задержанных list/detail запросов и игнорирование устаревших ответов; ширины 390 и 1440 px.
- `node --test scripts/performance/*test.mjs scripts/demo-seed-identity.test.mjs`: **20/20**. Включая 409/503 с сохранёнными статусом и причиной, пустые страницы, проваленную группу операций и сохранение полного отчёта.
- Полный стандартный NF08 повторён в Docker Desktop/WSL2 с polling 1000 мс: валидатор `passed=true`, 2830 запросов, API p95 ниже обоих порогов, очереди после drain нет. Измерение не является нативным Linux-хостом или production capacity test.
- `npm run check:agents`: **561/561**, 16 skills синхронизированы, `overview:check` для Markdown/HTML и VitePress build прошли. `git diff --check` и проверка staged diff прошли; спецификация не менялась. Результаты также зафиксированы в `WORKLOG.md`.

## Проверка реализации NF05 — 2026-11-11

- Maven `verify` в Java 21-контейнере с Testcontainers/PostgreSQL 17.11: **37 тестов, 0 failures/errors/skipped**, `BUILD SUCCESS`; миграции V1–V8 применились на чистой тестовой БД. Отдельно повторён bounded-cycle тест: 1/1.
- `npm --prefix frontend run lint`, `test:styles`, `build` — прошли. `test:session` прошёл с Vite на временном порту 15717 и Chrome: отображение аудита, сессия, polling и обёртка текста на 390/1440 px.
- Изолированный полный Compose smoke с семью демозаданиями прошёл: операторский API вернул seeded-проблему `FAILED/PENDING`; `test:browser` прошёл на 390/1440 px. На другом чистом Compose project `test:task004` подтвердил задержанный результат, `executions=1` и проблему в списке оператора.
- `bash scripts/check-task004.sh` прошёл внутри Linux-контейнера Docker Desktop. После backend restart при активном lease и PostgreSQL restart с тем же volume сценарий явно проверил `attemptsAfter=2`, `newBusinessStatus=SUCCEEDED`, причину `TEMPORARY_DELIVERY_FAILURE`, совпадение полной истории с JSONB `details` и сохранение аудита назначения; доставка восстановлена с тем же `operationId`, независимый GET показал `executions=1`. Изменённый PowerShell-скрипт проверен парсером, но повторно не исполнялся: в текущем Windows-хосте нет Java/JAVA_HOME; эквивалентный Linux lifecycle исполнен.
- `npm run check:agents`: **561/561**, skills synchronized (16), Project Overview актуален, VitePress собран. `git diff --check` прошёл.

Подтверждение Linux относится к Linux-контейнеру на Docker Desktop/WSL2, не к отдельному нативному Linux-хосту. Новый NF08 не запускался: изменения NF05 не затрагивали нагрузочный путь, а ранее сохранённые NF08 JSON и результаты не переписывались.

## TASK-001.03 — V7 audit backfill и повтор NF08 seed — 2026-11-12

- PostgreSQL migration regression `migrationBackfillsLegacyV7AuditTransitionDetailsFromStoredHistory`: **1/1** прошёл; моделирует V7, затем V8/V9 и проверяет создание, попытки/повторы, применение из сохранённого external snapshot, конфликт, reconciliation decision, manual recovery, empty-details guard и явную пометку отсутствующего результата без подстановки текущего статуса.
- Maven `verify` на PostgreSQL Testcontainers 17.11: **43/43**, 0 failures/errors/skipped, `BUILD SUCCESS`.
- Изолированный Linux NF08 runner на Compose project `nf08-linux-20261111-234012-2133fca0`: после подготовки обнаружено 5000 заданий, 5000 outbox и 15000 audit events, для всех событий details непусты; тест внешнего ledger подтвердил 5000 записей. Прогрев — 791 HTTP-запрос и 196 созданий; измерение — 3218/3218 успешных, 0 ошибок и бизнес-отказов. p95 чтений/изменений 1186,4/1207,9 мс.
- В измерении принято 806 заданий; очередь была 100 при старте, 403 на границе и 0 после drain. На границе уже исполнены 403/806; оставшиеся 403 обработаны за 51,911 с. Внешняя задержка p95 — 57 869,6 мс по 806 временам; это измерение, не SLA спеки. Лимиты HostConfig совпали с cgroup: 2 CPU / 4096 MiB суммарно; polling 1000 мс, batch 16.
- Исходный JSON: [nf08-task-001-03-2026-11-12.json](nf08-task-001-03-2026-11-12.json). Временный project и его том удалены раннером; пользовательский Compose project не менялся.

### Итоговое подтверждение NF05 — 2026-11-12

V9 уже применена к сохранённой БД проекта `secreate-review` без пересоздания PostgreSQL, `down`, повторного seed или удаления тома. Контейнер PostgreSQL и именованный том остались прежними; Flyway сообщает версию 9. Сохранены 8 заданий, 8 outbox, 36 событий, 1 аудит назначения и 7 внешних исполнений. Все 36 событий имеют непустые details; в этой БД не потребовалось пометок о недоступном payload. Read-only проверка завершилась значениями `9, 36, 0, 0, 8, 8, 7` для версии, событий, пустых details, недоступных payload, заданий, outbox и исполнений. Alice API после backend-only restart вернул HTTP 200.

Следовательно, NF05 для текущих и восстановимых исторических событий подтверждён; если в другой старой БД источник payload действительно отсутствует, V9 сохраняет явный маркер недоступности и не выдумывает данные. Спецификация не менялась. Не коммичено и не отправлено.
