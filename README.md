# Secreate-test

Локальная система обмена заданиями на Spring Boot, React/TypeScript/Vite и PostgreSQL. Реализованы реестр, доставка в отдельный эмулятор, сверка, восстановление и операторский интерфейс. Полная сверка D01–D07, NF01–NF10 и разделов 7/10, включая NF08, описана в [отчёте нагрузки и приёмки](docs/project/performance.md); оставшиеся ограничения перечислены ниже и в [бизнес-допущениях](docs/project/business-assumptions.md).

Спецификации размещаются в `docs/specs/`; при запуске передайте агенту путь к выбранной спецификации и попросите выполнить `START_PROMPT.md`. Например: `codex "Прочитай START_PROMPT.md и выполни его для спецификации <путь-к-спецификации>"`. Можно передать и другой доступный путь.

Установка агентских инструментов: `npm ci`; проверка: `npm run check:agents`. Команды проверок приложения описаны в `docs/project/quality-checks.md`. Serena и MCP необязательны.

## Локальный запуск (PowerShell)

Нужны Java 21 с `JAVA_HOME`, Node.js, npm и работающий Docker с Compose. Команды выполняются из корня; пароль и учётные записи ниже предназначены только для локальной демонстрации.

1. Запустите PostgreSQL: `docker compose up -d --wait`. Данные хранятся в томе Compose; схема применяется Flyway при старте backend. Для полностью чистой базы используйте новый project name, например `docker compose -p secreate-demo up -d --wait postgres`: это отдельный том и не удаляет данные текущего project.
2. В первом терминале подготовьте и запустите эмулятор:

```powershell
cd backend
$env:EXECUTOR_DB_URL='jdbc:postgresql://localhost:5432/exchange'
$env:EXECUTOR_DB_USER='exchange'
$env:EXECUTOR_DB_PASSWORD='local-demo-only'
.\mvnw.cmd -B -ntp compile dependency:build-classpath '-Dmdep.outputFile=target/classpath.txt'
& "$env:JAVA_HOME\bin\java.exe" -cp ("target/classes;" + (Get-Content -Raw target/classpath.txt).Trim()) ru.secreate.exchange.emulator.EmulatorMain 9090
```

3. Во втором терминале запустите API:

```powershell
cd backend
$env:SPRING_DATASOURCE_URL='jdbc:postgresql://localhost:5432/exchange'
$env:SPRING_DATASOURCE_USERNAME='exchange'
$env:SPRING_DATASOURCE_PASSWORD='local-demo-only'
.\mvnw.cmd spring-boot:run
```

4. В третьем терминале: `npm --prefix frontend ci`, затем `npm --prefix frontend run dev`. Откройте адрес Vite. Его прокси направляет `/api` на `localhost:8080`.

После запуска эмулятора и API загрузите демонстрационный набор на чистом томе: `& .\scripts\demo-seed.ps1`. Seed создаёт семь заданий для Alice и Bob, воспроизводит четыре режима D07, сохраняет операторское назначение с аудитом и проверяет хотя бы одно успешное завершённое задание.

Для демонстрации войдите под `alice` / `demo-alice` или `bob` / `demo-bob`: каждый видит только свои задания. Под `operator` / `demo-operator` откройте вкладку «Проблемы» и карточку с названием `TASK004 Demo … unavailable; operator review`: она остаётся в состоянии доставки FAILED и исполнения PENDING после пяти попыток; история доступна в карточке, а независимый `GET /operations/{operationId}` возвращает 404. Внешняя недоступность намеренно остаётся включённой после seed. После просмотра сбросьте её: `& .\scripts\emulator-mode.ps1 -Mode Reset`. Таблица ожидаемых состояний всех режимов — в [docs/project/integrations.md](docs/project/integrations.md).

Для ручной демонстрации включайте режим перед созданием задания: `& .\scripts\emulator-mode.ps1 -Mode Unavailable`; `& .\scripts\emulator-mode.ps1 -Mode DropAfterSave`; `& .\scripts\emulator-mode.ps1 -Mode DuplicateResult`; `& .\scripts\emulator-mode.ps1 -Mode DelayedResult -DelayMs 2200`. Сброс: `& .\scripts\emulator-mode.ps1 -Mode Reset`. В таблице D07 в контракте указаны ожидаемое состояние приложения и независимый `GET /operations/{operationId}` для каждого режима.

Демо-пользователи: `alice` / `demo-alice`, `bob` / `demo-bob`, `operator` / `demo-operator`. Оператор видит область владельца alice, Bob — только свои задания. Остановите процессы в их терминалах; `docker compose stop` останавливает БД без удаления данных.

Проверки: в `backend/` — `.\mvnw.cmd -B -ntp verify` (нужен Docker для Testcontainers); из корня — `npm --prefix frontend run lint`, `npm --prefix frontend run test:styles`, `npm --prefix frontend run build`, `npm run check:agents`. Полный `& .\scripts\check-task004.ps1` на чистом временном томе сам запускает `test:browser` и `test:task004` в Chrome; путь к браузеру можно передать через `-BrowserPath` или `TASK3_BROWSER`. Для ручного запуска тестов с уже работающими сервисами используйте `npm --prefix frontend run test:browser` и `npm --prefix frontend run test:task004`.

## NF08: 5000 записей и нагрузочный профиль

Полный воспроизводимый прогон выполняется из корня после установки `JAVA_HOME` на Java 21: `& .\scripts\run-nf08.ps1 -DrainSeconds 120`. Скрипт создаёт отдельный временный Compose project и чистый том, собирает API и эмулятор, запускает PostgreSQL 17, сбрасывает все режимы сбоев, проверяет реальные `HostConfig` и cgroup-лимиты трёх контейнеров, загружает данные, запускает прогрев и измерение, а затем ограниченное ожидание внешней доставки. Генератор Node.js выполняется на хосте вне квот контейнеров; браузер не работает во время замера. После успешного прогона скрипт удаляет только собственный временный том; при ошибке оставляет среду для диагностики.

Профиль: 30 секунд прогрева, 120 секунд измерения, 20 клиентов и не более одного незавершённого запроса на клиента; четыре операции чередуются поровну: `GET /api/tasks?status=...&page=...` (20 строк на странице), `GET /api/tasks/{id}`, `POST /api/tasks` и `PATCH /api/tasks/{id}/assignee`. Используются demo-учётные записи Alice, Bob и operator с действующей областью доступа; PATCH получает эксклюзивные записи Alice и актуальную `local_version`. В performance Compose интервал опроса фонового worker — 50 ms; backoff повторов сохраняется. Отчёт записывается в `docs/project/performance.md`; машинный JSON и TSV подготовленных записей остаются в игнорируемом `backend/target/performance/`.

Отдельная повторяемая подготовка 5000 строк выполняется командой `& .\scripts\prepare-nf08.ps1 -ProjectName <имя-проекта-nf08>` при запущенном проекте с `compose.performance.yaml`. Команда пересобирает только строки с префиксом `nf08-fixture-`, проверяет распределение Alice/Bob, связанные outbox-события, внешний ledger и область оператора, затем сохраняет список фикстур. Для обычной демонстрации используйте только небольшой набор `demo-seed.ps1` из раздела 7, а не нагрузочные фикстуры.

`npm --prefix frontend run test:session` проверяет изоляцию сессий, порядок сетевых ответов, повторное использование ключей и длинные названия в браузере с управляемыми ответами API. Для него нужен запущенный Vite и Chrome; backend не требуется.

`npm --prefix frontend run test:task004` проверяет реальную карточку при задержанном ответе эмулятора; нужны Chrome, Vite, backend, PostgreSQL и эмулятор. Полный сценарий `& .\scripts\check-task004.ps1` сам создаёт изолированный Compose project, загружает seed, останавливает backend во время обмена, перезапускает backend и PostgreSQL с тем же томом, затем удаляет только созданный им временный project/volume. Для команды требуется `JAVA_HOME` с Java 21 и свободные локальные порты 5432, 8080 и 9090.

Для дополнительных браузерных сценариев потери ответа на отдельной локальной тестовой БД задайте `$env:TASK3_POSTGRES_CONTAINER=(docker compose ps -q postgres)` перед `npm --prefix frontend run test:browser`. Тест создаёт собственные задания и временно отодвигает их повторную отправку в PostgreSQL. Не направляйте этот сценарий на общую или production-базу.

Договорённости по API и применению результатов — [docs/project/api.md](docs/project/api.md) и [docs/project/integrations.md](docs/project/integrations.md). Правила интерфейса — [docs/project/frontend.md](docs/project/frontend.md). Бизнес-допущения и известные ограничения — [docs/project/business-assumptions.md](docs/project/business-assumptions.md). При потере связи повторное создание в текущем сеансе использует тот же ключ; бизнес-результат и доставка учитываются отдельно. Внешняя проверка при сверке и локальный commit не являются распределённой транзакцией.
