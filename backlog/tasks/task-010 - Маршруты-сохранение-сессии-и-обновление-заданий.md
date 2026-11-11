---
id: TASK-010
title: 'Маршруты, сохранение сессии и обновление заданий'
status: Done
assignee: []
created_date: '2026-11-11 17:13'
updated_date: '2026-11-11 17:33'
labels: []
dependencies: []
modified_files:
  - frontend/src/App.tsx
  - frontend/src/navigation.ts
  - frontend/src/session.ts
  - frontend/tests/session-regression.cjs
  - docs/project/frontend.md
  - docs/project/auth-and-security.md
  - README.md
  - PROGRESS.md
  - WORKLOG.md
priority: high
type: feature
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Добавить адресуемые страницы реестра, проблем и карточки задания; восстанавливать успешный demo-вход после перезагрузки; автоматически обновлять открытую карточку и текущий отфильтрованный реестр каждые 5 секунд.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Страницы имеют URL /tasks, /tasks/problems и /tasks/:id; прямой переход, обновление страницы и browser back/forward открывают ожидаемое состояние, фильтр и номер страницы восстанавливаются из URL.
- [x] #2 Успешный вход сохраняется на время вкладочной сессии и восстанавливается после reload; недействительные данные удаляются, выход очищает сохранённую сессию.
- [x] #3 Открытая карточка автоматически перечитывается каждые 5 секунд; опрос прекращается при закрытии карточки или завершении сессии.
- [x] #4 Реестр автоматически перечитывается каждые 5 секунд по актуальным режиму, фильтру и странице; устаревшие ответы не заменяют текущие данные.
- [x] #5 Добавлены детерминированные браузерные регрессии на маршруты, reload-вход, оба режима polling и смену фильтра/страницы; frontend lint, test:styles, test:session, build и check:agents проходят.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Цель и архитектура: сохранить текущий React/Vite и Basic-auth контракт без новой зависимости роутера; добавить небольшой модуль URL-маршрутов с History API и module вкладочной demo-сессии на sessionStorage. App восстанавливает/валидирует credentials, синхронизирует маршрут, фильтр и страницу с URL, а два независимых таймера опрашивают либо выбранную карточку, либо только активный реестр раз в 5000 мс; имеющиеся sequence guards остаются барьером от устаревших ответов. Чувствительный пароль хранится только в sessionStorage текущей вкладки и удаляется при logout.

Расширить frontend/tests/session-regression.cjs: проверить адрес карточки, прямой переход/reload/back, sessionStorage после входа/logout, периодический detail request и polling list по выбранным фильтру/странице; запустить test:session и зафиксировать ожидаемый RED.

Добавить frontend/src/navigation.ts с парсером и форматированием URL /tasks, /tasks/problems, /tasks/:id; при popstate восстанавливать состояние, при действиях менять History API, status/page держать в query.

Добавить frontend/src/session.ts для версионированных load/save/clear credentials в sessionStorage; App должен валидировать восстановленный вход запросом к API, сохранять успешный вход и очищать его при logout.

В frontend/src/App.tsx добавить обновление открытой карточки и активного реестра раз в 5000 мс; остановить таймеры при смене страницы/сессии и применять только ответы актуальных запросов, маршрута, фильтра и страницы.

Обновить docs/project/frontend.md о URL, вкладочной сессии и частоте polling; выполнить frontend lint, test:styles, test:session, build, npm run check:agents, сверить diff и зафиксировать результаты.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Проверено: frontend lint, test:styles, test:session, build прошли; браузерный test:browser на реальном isolated Compose backend прошёл на 390/1440 px, прямой nginx route /tasks/problems ответил 200. npm run check:agents: 561/561, 16 skills синхронизированы, Overview check и docs build успешны. Временный Compose project и его том удалены. Новых зависимостей не добавлялось; backend и Maven verify не затрагивались. Изменения оставлены без commit/push.
<!-- SECTION:FINAL_SUMMARY:END -->
