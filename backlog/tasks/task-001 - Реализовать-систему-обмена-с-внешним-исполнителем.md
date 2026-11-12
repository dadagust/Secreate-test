---
id: TASK-001
title: Реализовать систему обмена с внешним исполнителем
status: Done
assignee: []
created_date: '2026-11-10 13:17'
updated_date: '2026-11-11 23:56'
labels: []
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Источник: docs/specs/04-system-integration.md. Реализовать сквозной продукт на Java/Spring Boot, React/TypeScript и PostgreSQL с независимым эмулятором.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 D01–D04 и D-NF01–03: долговечная доставка, ограниченные повторы, идемпотентное исполнение и обработка результатов.
- [x] #2 D05–D07: сверка, журнал и проблемы, разрешённое восстановление, независимо проверяемый эмулятор и режимы сбоев.
- [x] #3 NF01–NF07, NF09–NF10: постоянное хранение, разграничение доступа, аудит, доступный интерфейс, UTC, воспроизводимый запуск и автоматические проверки с PostgreSQL.
- [x] #4 NF08: генерация 5000 записей и нагрузочный сценарий с отдельными p95 и отчётом об ошибках при заданных ограничениях.
- [x] #5 Документация содержит запуск, пользователей, архитектуру, API, бизнес-допущения, результаты проверок и ограничения.
- [x] #6 NF04: Idempotency-Key и хэш запроса атомарны с заданием и outbox; одинаковый повтор возвращает прежнее задание, конфликт — 409, operationId стабилен.
- [x] #7 D03/NF03: входящий результат валидируется до ResultDecision; сравнение и обновление защищены транзакционной блокировкой от гонки версий.
- [x] #8 D04/D-NF01: попытки, next_attempt и захваты сохранены в PostgreSQL; истёкший захват восстанавливается после рестарта с прежним operationId; потеря ответа не увеличивает счётчик исполнения выше 1.
- [x] #9 NF08: реализованы PATCH /api/tasks/{id}/assignee с правами, локальной версией и аудитом и фильтр status для GET /api/tasks; профиль на 5000 записей пройден, результаты зафиксированы в docs/project/performance.md.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Зафиксировать контракт и модель состояний; спроектировать схему PostgreSQL и границы ответственности. 2. Создать сервер и независимый эмулятор, миграции, аутентификацию и транзакционный журнал операций. 3. Реализовать устойчивую доставку, обработку повторных и устаревших результатов, сверку и операторское восстановление. 4. Реализовать интерфейс React и демонстрационные данные. 5. Добавить интеграционные и конкурентные тесты, Compose, генератор нагрузки и инструкции; выполнить доступные проверки и зафиксировать ограничения.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Созданы backend Spring Boot 4.1.2 и Maven Wrapper; подготовлен проект контракта docs/project/integrations.md. Изолированное правило версий покрыто 4 тестами. Maven verify: 5 тестов прошли, включая PostgreSQL Testcontainers. Продукт, API, БД, эмулятор, UI, Compose и нагрузочный прогон не реализованы. Следующий этап: схема и транзакционное сохранение заданий и операций с проверками доступа.

Первый сквозной сценарий реализован: POST /api/tasks, атомарные ключ/хэш/задание/outbox, доставка с неизменным operationId в отдельный Java-процесс эмулятора, валидация и атомарное применение результата. Maven verify: 11 tests, 0 failures/errors/skipped. Проверены параллельные POST и 409, гонка версий, недопустимый результат, истёкший захват, потеря ответа после commit; GET эмулятора подтверждает executions=1. Восстановление проверено новым экземпляром воркера по БД, а не kill/restart всего backend. npm run check:agents: 560 passed, skills синхронны, HTML актуален, VitePress build прошёл после исправления оформления localhost URL. NF08 PATCH assignee и фильтр status зафиксированы как контракт следующего этапа, не реализованы. Общие критерии 1–5 пока не закрыты.

Исправлены транзакционная проверка актуального lease перед результатом, атомарное завершение и история; просроченная последняя попытка очищает токен и фиксирует LAST_LEASE_EXPIRED. Конфликты сохраняются в result_conflicts с номером попытки, версиями, статусами и причиной. Эмулятор различает 400, 409, 503 и отдаёт GET с сохранёнными status, version, executions. Maven verify: 15 тестов, 0 failures/errors/skipped; проверены поздний ответ, откат записи истории, ошибка SQL эмулятора с последующим восстановлением и повтором, потеря ответа и executions=1. npm run check:agents — 560 тестов, 0 ошибок, skills и обзор синхронизированы, документация собрана. Операторская сверка остаётся следующим этапом.

Удалён обходной accept(): тесты обработки результатов используют только complete с проверкой действующего lease и транзакционным сохранением конфликта. Эмулятор в ответе на повторный POST читает сохранённые version и status из БД; регрессия воспроизведена до исправления и проверена после него, GET и POST согласованы. Maven verify: 15 тестов прошли; npm run check:agents: 560 тестов прошли, skills, overview и VitePress проверены. TASK-001 остаётся In Progress.

На момент этой записи, после TASK-004, были подтверждены критерии #1 (D01–D04/D-NF01–03), #2 (D05–D07), #3 (NF01–NF07/NF09/NF10) и #5 (запуск, пользователи, архитектура, API, допущения, результаты и ограничения): Maven verify 27 тестов на PostgreSQL; браузерные smoke 390/1440 px; restart backend/PostgreSQL с тем же томом, сохранением истории и аудита, продолжением отправки и executions=1; check:agents 560/560; README и docs/project обновлены. Тогда критерий #4 NF08 ещё ждал нагрузочного прогона; результат TASK-005 записан ниже.

Итог TASK-005: NF08 пройден на 5000 согласованных записей при совокупном ограничении 2 vCPU/4 GiB. 30s прогрев и 120s измерение, 20 последовательных клиентов; 3247 успешных HTTP-запросов, ошибок/таймаутов нет. p95: чтения 1110.8 ms из 2000 ms, изменения 1197.4 ms из 3000 ms. После дополнительного дренирования внешне завершены все 811 измерительных созданий, незавершённых — 0. Реальные ресурсы контейнеров подтверждены через HostConfig и cgroup. Матрица требований и ограничения в `docs/project/performance.md`; команды, версии среды и сырые JSON/фикстуры описаны там же.

Финальная приёмка 2026-11-11: Maven `verify` — 30 tests, 0 failures/errors/skips; frontend lint, `test:styles`, `test:session`, build прошли; `test:browser` и `test:task004` прошли на 390/1440 px; lifecycle restart backend/PostgreSQL подтвердил сохранность истории/аудита и независимый `executions=1`; `npm run check:agents` — 560 passed, синхронизация skills, обзор и сборка VitePress прошли. TASK-001 завершена.

Повторная приёмка в TASK-006 проверяет все требования и исправляет отчёт NF08; закрытие приостановлено.

Повторная сверка TASK-006: матрица docs/project/acceptance.md подтверждает требования фактическими тестами. NF08 пройден по API-порогам; при стандартном polling 1000 мс зафиксирована большая очередь, пределы наблюдения описаны в performance.md. Linux проверен в контейнерах Docker Desktop.

Повторная сверка 2026-11-11 нашла пробел NF05: автоматическое применение результата пишет только RESULT_* event с actor/task/time, но не сохраняет прежний и новый бизнес-статус и версии. Assignment audit и reconciliation snapshots этого не заменяют. Критерий #3 снят, реализация отслеживается в TASK-001.01; parent возвращён в In Progress.

Критерий #3 закрыт после TASK-001.01: V8 JSONB-аудит переходов добавлен, операторская область доступа сохранена, API и карточка показывают содержимое истории. Maven verify 37/37, frontend lint/styles/build/session, изолированные browser/test:task004, Linux-container lifecycle с PostgreSQL restart и check:agents 561/561 прошли. Матрица и историческое ограничение старых событий описаны в docs/project/acceptance.md.

Повторная сверка TASK-011 выявила нарушения D04 и неработающую штатную сборку NF08-отчёта. Задача повторно открыта до исправления и повторных проверок в TASK-001.02.

Финальная сверка 2026-11-12: новые действия удовлетворяют NF05, но существующие события до V8 после миграции имеют пустые details. Старые/новые значения невозможно восстановить из сохранённых данных без выдумывания аудита; критерий #3 снят до проверки наличия авторитетного источника исторических изменений.

NF05 criterion #3 is completed through TASK-001.03: migration V9 backfills old audit details only from verified sources and explicitly marks unavailable payloads; PostgreSQL V7-to-V9 regression, fixture guard, full verify (43/43), Node checks (20/20), check:agents (561/561), and a valid standard NF08 rerun (3218/3218 requests, p95 reads/changes 1186.4/1207.9 ms, queue drained) passed. The persistent review database migrated backend-only with its volume and existing rows preserved. docs/specs/04-system-integration.md is unchanged.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Повторно подтверждено в TASK-001.02: D04 lock-wait регрессии прошли на PostgreSQL; NF08 повторён на корректных полных страницах, 2830/2830 запросов успешны, p95 чтений/изменений ниже порогов, JSON сохранён; docs, frontend polling, agent checks и VitePress проверены.

Повторный аудит 2026-11-12 оставил TASK-001 в In Progress: текущие события NF05 полны, но исторические строки до V8 не содержат детали изменения, а надёжный источник для backfill не подтверждён. Maven 42/42, NF08 валиден, frontend/session и check:agents прошли; точная оговорка в docs/project/acceptance.md.

TASK-001 closed after child TASK-001.03 completed NF05 historic audit backfill and final verification. All nine acceptance criteria are checked. The latest standard NF08 passed and its JSON/report are retained. No commit or push.
<!-- SECTION:FINAL_SUMMARY:END -->
