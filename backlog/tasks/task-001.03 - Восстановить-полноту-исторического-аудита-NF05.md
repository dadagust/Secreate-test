---
id: TASK-001.03
title: Восстановить полноту исторического аудита NF05
status: Done
assignee: []
created_date: '2026-11-11 23:20'
updated_date: '2026-11-11 23:56'
labels: []
dependencies: []
parent_task_id: TASK-001
type: bug
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Обеспечить структурированное содержание для восстановимых событий из схемы V7 при переходе на V8, исправить генератор NF08-фикстур, который продолжает вставлять события с пустыми details, и честно обозначить события, чьё содержание нельзя восстановить из сохранённых источников. Не редактировать спецификацию.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Миграция V7→текущая версия дополняет восстановимыми старыми/новыми значениями события CREATED, ATTEMPT, RETRY, RESULT_APPLY и поддерживаемые события conflict/reconciliation/recovery; не подставляет непроверяемые данные.
- [x] #2 Интеграционный тест на PostgreSQL стартует со схемы V7 и проверяет backfill и порядок состояний после миграции.
- [x] #3 scripts/performance/seed-nf08.sql создаёт полные details у всех событий фикстур; автоматическая проверка ловит новые пустые записи.
- [x] #4 Обновлены ADR, матрица приёмки, PROGRESS и WORKLOG; спека не изменена.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Добавить RED PostgreSQL тест миграции V7→V9 с известной последовательностью событий. 2. Реализовать отдельную V9 migration с реконструкцией только из записанных источников. 3. Исправить seed NF08 и регрессию на fixture audit. 4. Проверить тесты и migration на актуальной структуре, повторить relevant checks. 5. Обновить документы и пересчитать состояние TASK-001; не объявлять полное соответствие для невосстановимых записей.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
V9 backfills only verified values from ledger/snapshots/conflicts/recovery commands and marks unavailable legacy payloads without fabrication. PostgreSQL V7-to-V9 regression passed; full Maven verify 43/43; NF08/seed regressions 20/20; standard isolated NF08 3218/3218 HTTP 200 with API p95 1186.4/1207.9 ms and drain queue 0; check:agents 561/561. Preserved Compose DB was upgraded backend-only to V9 with all 36 events non-empty and existing records unchanged. Specification untouched.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed after V7-to-V9 PostgreSQL migration regression, audit seed guard, documentation/ADR updates, full Maven verify (43/43), Node regressions (20/20), check:agents (561/561), and a valid standard NF08 rerun. No spec changes, commit, or push.
<!-- SECTION:FINAL_SUMMARY:END -->
