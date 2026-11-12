---
id: TASK-001.02
title: Исправить оставшиеся пробелы соответствия спецификации
status: Done
assignee: []
created_date: '2026-11-11 22:18'
updated_date: '2026-11-11 22:52'
labels: []
dependencies: []
parent_task_id: TASK-001
type: bug
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Устранить четыре воспроизводимых несоответствия, найденных TASK-011: перепроверка lease после блокировок PostgreSQL, корректное завершение busy-состояния при polling, рабочая сборка NF08-отчёта, полный переходный аудит конфликтного результата. Спецификацию не изменять; сохранять существующие staged и unstaged изменения.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 D04: истёкший lease не меняет задание, outbox и историю, в том числе если ожидание блокировки БД произошло после первоначальной проверки
- [x] #2 D06: завершившийся polling не оставляет реестр, карточку или операторские действия заблокированными; устаревшие ответы не применяются
- [x] #3 NF08: полный профиль сохраняет JSON; HTTP 409/503 отражаются исходным статусом и причиной и делают профиль неуспешным
- [x] #4 NF05: конфликтный автоматический переход сохраняет фактический старый и новый статус доставки, результат, версии и причину
- [x] #5 Добавлены детерминированные регрессии; Maven verify, frontend session checks, NF08 Node tests, check:agents и diff check выполнены и отражены в задаче/журнале
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Цель: устранить четыре подтверждённых пробела D04, D06, NF08 и NF05 без изменения спецификации. Архитектура: завершать применение только после захвата строк outbox и task и повторной проверки clock_timestamp; отделить актуальный ответ polling от foreground busy-состояния; формировать отчёт через единый summarizer метрик; записывать фактически зафиксированное старое состояние outbox из заблокированной строки. Технологии: Java 21, Spring Boot, PostgreSQL, React, TypeScript, Vite и Node test runner. Источник: docs/specs/04-system-integration.md. Шаги: 1) Проверить и сохранить Git-индекс; 2) покрыть гонки complete/finish/reject в backend/src/test/java/ru/secreate/exchange/DeliveryTest.java; 3) исправить backend/src/main/java/ru/secreate/exchange/ExchangeService.java; 4) проверить старое/новое состояние события конфликта на PostgreSQL; 5) добавить задержанные polling-регрессии в frontend/tests/session-regression.cjs и поправить busy-флаги в frontend/src/App.tsx; 6) покрыть сводку четырёх фаз в scripts/performance/nf08-profile-validation.test.mjs и использовать её из scripts/performance/nf08-load.mjs; 7) выполнить Maven verify, frontend checks, полный стандартный NF08, Node tests, check:agents и diff check; 8) обновить acceptance, performance, Overview, README, PROGRESS, WORKLOG и статусы по фактическим результатам.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Исходное воспроизведение: complete() принимал ответ после истечения lease при ожидании блокировки строки задания; finish() сбрасывал token после ожидания outbox; reject() переводил просроченную попытку в REVIEW; аудит противоречивого пакета записывал oldDeliveryState=null. Браузерная регрессия показала, что карточка после polling остаётся с отключёнными действиями. NF08 раннер падал перед JSON из-за вызова неопределённой summarizeMetric. Дальше фиксировать RED/GREEN результаты, идентификаторы прогонов и ограничения Docker Desktop/WSL2.

Подтверждение 12.11.2026: Maven verify на текущем смонтированном дереве — 42/42; frontend lint/styles/session/build и Node regressions — успешны; check:agents 561/561; фактический стандартный NF08 и сохранённый JSON passed=true. См. WORKLOG.md и docs/project/acceptance.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Устранены D04 lease races, D06 polling busy-state, NF08 summary/report failure и NF05 oldDeliveryState=null. PostgreSQL verify 42/42, Node tests 20/20, frontend lint/styles/session/build прошли; стандартный NF08 passed=true: 2830/2830 успешных, API p95 1306.2/1399.4 мс. check:agents 561/561 и git diff --check прошли. Спецификация не менялась.
<!-- SECTION:FINAL_SUMMARY:END -->
