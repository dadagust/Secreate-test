---
id: TASK-004
title: 'Режимы эмулятора, восстановление и демозапуск'
status: Done
assignee: []
created_date: '2026-11-10 20:19'
updated_date: '2026-11-10 22:05'
labels: []
dependencies:
  - TASK-003
parent_task_id: TASK-001
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Цель: воспроизводимые режимы отдельного эмулятора, восстановление обмена и загрузка демоданных на PostgreSQL. Источник: docs/specs/04-system-integration.md (D03, D04, D07, D-NF01–03, NF03, NF05, NF09, NF10, раздел 7). NF08-нагрузка остаётся отдельным критерием TASK-001.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Четыре режима воспроизводимо включаются и сбрасываются; фактический результат проверяется независимым GET /operations/{operationId}.
- [x] #2 На PostgreSQL проверены восстановление после 503, потеря ответа с прежним operationId и executions=1, дубликат без эффекта, stale version и UI при задержке.
- [x] #3 Backend restart и PostgreSQL restart с тем же томом сохраняют задания, историю, аудит и ожидающую отправку; исполнение однократное.
- [x] #4 Чистый запуск и seed создают двух инициаторов, оператора, минимум шесть задач с разными историями; README документирует миграции и все режимы.
- [x] #5 NF10: журналы содержат operationId и исход, без секретов; D03/D04/D07, D-NF01–03, NF03/NF05/NF09/NF10 проверены.
- [x] #6 Maven verify, frontend lint/test:styles/build, browser smoke и check:agents выполнены; NF08 остаётся в TASK-001.
- [x] #7 DeliveryWorker валидирует весь batch до первого применения: одна строка или точный дубль; повтор operationId с той же версией и разными статусами отклоняется целиком и сохраняется как операторская проблема.
- [x] #8 Ручное восстановление связывает Idempotency-Key с последним событием сбоя: повтор одной команды использует прежний ключ, после новой ошибки создаётся новый; API/PostgreSQL подтверждают одну запись MANUAL_RECOVERY на команду и идемпотентный повтор ключа.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
**Цель:** воспроизводить четыре режима отдельного эмулятора, проверять рестарты backend/PostgreSQL и загружать демоданные. **Архитектура:** EmulatorMain хранит режимы и исполнения в PostgreSQL schema executor; локальные команды управляют режимами. Worker журналирует operationId/outcome. Скрипты проверяют lifecycle и создают seed через API. **Стек:** Java 21, Spring Boot, PostgreSQL, Maven Wrapper, Compose, PowerShell, React/Vite/Playwright. **Источник:** docs/specs/04-system-integration.md.

RED: добавить тесты PostgreSQL для 503 до execution, drop после commit, duplicate result и задержки с PENDING/активным lease; подтвердить ожидаемое падение.

GREEN: реализовать FaultModeStore/EmulatorMain и loopback PUT/DELETE/GET /fault-modes; drop одноразовый и атомарный, задержка ограничена; проверить независимый GET operation.

DeliveryWorker: принять одну/две строки результата; журналировать operationId, attempt, outcome; проверить duplicate и stale version без повторного эффекта.

Скрипты: создать scripts/emulator-mode.ps1 и demo-seed.ps1; seed создаёт минимум шесть задач двух инициаторов через API с различными историями обмена.

Playwright и PostgreSQL: проверить задержанную карточку в UI и все четыре режима; после ответа эмулятора сверить operationId, version и executions.

Lifecycle: scripts/check-task004.ps1 на чистом томе запускает seed и browser suites, останавливает backend после внешнего commit при активном сохранённом lease, автоматически ждёт его истечения и проверяет новую попытку; затем перезапускает PostgreSQL с тем же Compose volume и сверяет конкретные строки заданий, истории и аудита.

Документация и gates: README/API/integrations/quality-checks/PROGRESS/WORKLOG; clean-start, Maven verify, frontend lint/styles/build, browser smoke, check:agents; NF08 оставить TASK-001.

Revision: 1) pre-parse DeliveryWorker response batch and apply exactly one validated result; persist same-version status contradictions as REVIEW/problem before any task mutation, with PostgreSQL regression tests. 2) replace lifecycle lease UPDATE with DB/API-observed lease expiry, compare attempt timestamps to the original lease deadline, and compare concrete pre/post restart history and audit rows. 3) leave one final unavailable demo task after seed; assert successful task plus operator problem-list/details access; document visible outcome and Reset command. 4) rerun Maven verify, fresh-volume lifecycle script, browser smoke, check:agents; update task/worklog/progress and regenerate overview.

Regression: add a browser session test for K1 -> RESULT_CONFLICT_REQUIRES_REVIEW -> K2 with a failed network retry retaining K2; add PostgreSQL/API test that each recovery transitions REVIEW to READY and records one MANUAL_RECOVERY, while replaying the same key does not add another. Include RESULT_CONFLICT_REQUIRES_REVIEW in the frontend failure-event selector, rerun requested gates, record evidence, then close TASK-004.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Фактическая проверка 2026-11-11: Maven verify — 29 тестов, без failures/errors/skips; PostgreSQL-регрессии DeliveryWorker доказали один apply для точного дубля и REVIEW без применения для contradictory same-version batch. Frontend lint, test:styles и build прошли. На чистом Compose volume check-task004.ps1 загрузил семь задач Alice/Bob, проверил DONE/SUCCEEDED и операторскую FAILED/PENDING с внешним 404, затем прогнал test:browser и test:task004 на 390/1440 px. Backend остановлен после внешнего commit при активном lease; API/БД подтвердили прежний operationId, естественное истечение lease и ATTEMPT_2, независимый GET подтвердил executions=1. PostgreSQL перезапущен с тем же volume; конкретные строки истории и аудита сохранены, ожидающая доставка завершилась, независимый GET снова показал executions=1. Итоговые журналы содержали operationId, attempt и outcome; в БД было 17 задач, 80 событий и 6 audit-записей. npm run check:agents — 560 passed, skills synced (16), overview актуален, VitePress build прошёл. NF08 нагрузочный прогон остаётся в родительской TASK-001.

Дополнительная регрессия 2026-11-11: App.tsx учитывает RESULT_CONFLICT_REQUIRES_REVIEW при вычислении нового ключа. test:session red показал повтор K1; после исправления подтвердил K1 → новый конфликт → K2, затем повтор после сетевой ошибки с прежним K2. PostgreSQL/API-тест создал два последовательных contradictory batch: для K1 и K2 endpoint возвращал успех, outbox становился READY, на каждую команду добавлялась ровно одна MANUAL_RECOVERY; повторы обоих ключей не дублировали событие. Maven verify — 30 тестов; frontend lint, test:styles, test:session, build и check:agents (560) прошли.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-004 завершена. Добавлена регрессия ручного восстановления после RESULT_CONFLICT_REQUIRES_REVIEW: после новой ошибки оператор получает новый Idempotency-Key, а сетевой повтор команды сохраняет его. UI session test подтвердил K1, новый конфликт, K2 и повтор K2; API/PostgreSQL подтвердила переход REVIEW → READY, одну MANUAL_RECOVERY на ключ и идемпотентность повторов. Общие проверки: Maven verify — 30 тестов; frontend lint, test:styles, test:session, build; check:agents — 560 passed с синхронизацией skills и сборкой VitePress.
<!-- SECTION:FINAL_SUMMARY:END -->
