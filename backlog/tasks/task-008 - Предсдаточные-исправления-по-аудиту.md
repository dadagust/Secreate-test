---
id: TASK-008
title: Предсдаточные исправления по аудиту
status: Done
assignee: []
created_date: '2026-11-11 14:50'
updated_date: '2026-11-11 18:43'
labels: []
dependencies: []
priority: high
type: enhancement
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Исправить выявленные предсдаточным аудитом ошибки в валидности профиля NF08, идентификации демозаписей, остановке фонового воркера и Linux-команде Maven. Источник требований продукта не менять: docs/specs/04-system-integration.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 NF08 выбирает только страницы с 20 элементами по фактическому числу записей, а некорректный ответ не засчитывается успешным; валидатор требует фактические запросы и успешные ответы ожидаемого HTTP-кода во всех четырёх группах и отклоняет быстрые 5xx.
- [x] #2 Добавлены регрессии пустой страницы и проваленной группы; повторный стандартный NF08 сохраняет новый JSON, ресурсы 2 CPU/4 GiB, 5000 фикстур, 20 клиентов, прогрев 30 с, измерение 120 с и polling 1000 мс; отчёт объясняет сопоставимость, ошибки, очередь и drain без выдачи drain за порог спеки.
- [x] #3 Seed идентифицирует только свои записи устойчивым Idempotency-Key, устанавливает fault mode до публикации нового задания и безопасно продолжает прерванную загрузку; детерминированные проверки покрывают чистый запуск, повтор, прерывание и пользовательскую задачу с совпадающим владельцем/заголовком без её изменения.
- [x] #4 DeliveryWorker прекращает claims при interrupt до claim и после прерванной HTTP-попытки, сохраняет attempt/retry семантику и флаг; PostgreSQL регрессии проверяют отсутствие лишнего claim и возможность повтора.
- [x] #5 Linux инструкции запускают Maven через sh ./mvnw с чистого архива, не смешивая оболочки Windows, Linux и Docker.
- [x] #6 WORKLOG.md, PROGRESS.md, performance.md, архитектурный Project Overview и TASK-008 содержат только проверенные результаты; Maven verify, NF08 validator tests, frontend/agent checks и новый Docker NF08 выполнены либо точное ограничение выполнения зафиксировано.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Goal: Close four audit findings without changing the system specification or overwriting the existing staged/unstaged work. Architecture: make the load generator enforce the registry's real 20-row page and HTTP 200 response contract, use stable idempotency keys as demo identity, and stop worker claims after interrupt while finalizing a claimed attempt through existing retry semantics. Keep NF08's resource envelope and timing profile unchanged.

Step 1: add deterministic NF08 page and profile validation regressions, then fix response classification and full-page selection.

Step 2: add demo seed identity/resume/collision regression coverage and implement stable-key-only seeding with fault setup before publication.

Step 3: add deterministic DeliveryWorker interruption tests and implement interrupt-safe bounded ticking and retry finalization.

Step 4: correct Linux Maven instructions; update performance, architecture/overview, progress and worklog from verified results.

Step 5: run Maven, NF08 validator/tests, frontend and agent checks, and a new isolated Docker NF08 profile where available; leave task open if key evidence fails.
<!-- SECTION:PLAN:END -->

## Результат

TASK-008 завершена по фактическим проверкам 2026-11-11. Полный стандартный NF08 на изолированном Docker Compose project прошёл: 2547/2547 HTTP 200, 0 ошибок/таймаутов, p95 чтений 1504.2 мс и изменений 1595.2 мс; на границе измерения очередь составляла 394, после фактического drain 52.799 с все 638 измерительных созданий имели внешнее исполнение и очередь была пуста. Исторические отчёты не переписывались, прежние выборки списка объявлены несопоставимыми.

`node --test scripts/demo-seed-identity.test.mjs scripts/performance/nf08-profile-validation.test.mjs scripts/performance/nf08-counts.test.mjs` — 16/16. `& .\scripts\check-demo-seed.ps1` прошёл на отдельном Compose project: прерывание после создания и до назначения возобновлено с прежним ID, повтор не создал дубликаты, пользовательская задача с тем же владельцем и заголовком не изменилась. Linux PostgreSQL/Testcontainers `sh ./mvnw -B -ntp verify` — 33 теста, 0 failures/errors/skips; запуск `sh ./mvnw` также проверен с копией wrapper-файла без executable bit. Frontend lint, test:styles и build прошли; `npm run check:agents` — 561/561, 16 skills синхронизированы, Overview и VitePress собраны.
