---
id: TASK-009
title: Предсдаточная проверка NF08 и README
status: Done
assignee: []
created_date: '2026-11-11 16:16'
updated_date: '2026-11-11 16:40'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Исправить потерю HTTP-статусов ошибок в NF08, синхронизировать актуальную статистику NF08 в acceptance и README и добавить короткий проверочный Docker-сценарий.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 HTTP 409 и 503 возвращаются как ошибки с исходным статусом и читаемой причиной; метрики и JSON содержат статус/причину, итоговая валидность профиля false.
- [x] #2 В acceptance и актуальных сводках отражены значения из JSON TASK-008: 394 незавершённых на границе, 244/638 внешних исполнений, 638/638 после drain, p95 1504.2/1595.2 мс; исторические записи сохранены.
- [x] #3 В начале README есть краткий Compose запуск, URL, демо-пользователи и основной операторский путь без дублирования платформенных руководств; описаны фактические результаты.
- [x] #4 Node-регрессии, check:agents и diff check проходят; Compose config и чистый изолированный Docker smoke выполняются, если среда доступна; исходный staged diff сохранён, спека не изменена.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Воспроизвести HTTP-ошибки тестами; исправить классификацию и проверить сохранение ошибок в профиле; сверить JSON TASK-008 и обновить acceptance/README; провести перечисленные регрессии и изолированный Compose smoke; записать фактические результаты и закрыть критерии только после проверок.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Проверено 2026-11-11: Node-регрессии 19/19; npm run check:agents 561/561 и 16 синхронизированных skills; compose config и diff check прошли. Чистый изолированный Compose project из копии без .git/node_modules/target/dist поднят и очищен; docker-up.ps1 и повторный seed завершились с кодом 0, сохранили семь исходных ID без дублей; UI HTTP 200, оператор видит карточку FAILED/PENDING, браузерный TASK-004 smoke прошёл. JSON 409/503 сохраняет статус/причину и passed=false. Maven не запускался: Java-код не менялся. Staged diff сохранён, спека не изменена.
<!-- SECTION:FINAL_SUMMARY:END -->
