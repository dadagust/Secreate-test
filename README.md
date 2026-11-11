# Secreate-test

Локальная система обмена заданиями на Spring Boot, React/TypeScript/Vite и PostgreSQL. Реализованы реестр, доставка в отдельный эмулятор, сверка, восстановление и операторский интерфейс. [Архитектура и потоки](docs/project/architecture.md), [API](docs/project/api.md), [модель данных](docs/project/data-model.md), [интеграция](docs/project/integrations.md), [допущения](docs/project/business-assumptions.md), [отчёт NF08](docs/project/performance.md) и [матрица приёмки](docs/project/acceptance.md) описаны отдельно. Матрица фиксирует соответствие требований спеки и способы их воспроизведения.

## Быстрый старт для проверки

Из корня проекта запустите полный Compose-набор и затем загрузите идемпотентные демоданные:

```sh
docker compose -p secreate-review -f compose.app.yaml up -d --build --wait
docker compose -p secreate-review -f compose.app.yaml run --rm --no-deps --build seed
```

Остановить этот проект с сохранением данных: `docker compose -p secreate-review -f compose.app.yaml stop`. Удаление его тома требует отдельного `down --volumes`.

Откройте [http://127.0.0.1:5173/](http://127.0.0.1:5173/). Для операторского сценария войдите как `operator` / `demo-operator`, откройте «Проблемы», выберите карточку `TASK006 Demo unavailable; operator review` и запустите «Сверить». Карточка показывает отдельные состояния доставки и бизнес-исполнения, историю и результат наблюдения эмулятора. Для входа инициатором используйте `alice` / `demo-alice` или `bob` / `demo-bob`.

Демо-учётные записи для входа:

| Логин | Роль | Пароль |
| --- | --- | --- |
| `alice` | Инициатор | `demo-alice` |
| `bob` | Инициатор | `demo-bob` |
| `operator` | Оператор | `demo-operator` |

Эти пароли предназначены только для локальной демонстрации.

Страницы доступны по `/tasks` (реестр), `/tasks/problems` (проблемы оператора) и `/tasks/<id>` (карточка). Вход сохраняется после reload текущей вкладки; активная карточка и текущий список обновляются каждые 5 секунд.

Сейчас приложение поддерживает создание и реестр заданий, outbox-доставку со стабильным `operationId`, четыре режима эмулятора, операторскую сверку, ручное восстановление и аудит назначения. В исправленном стандартном NF08-профиле при 5000 фикстурах и лимитах 2 CPU / 4 GiB получено 2547/2547 успешных HTTP 200; p95 чтений/изменений — 1504,2/1595,2 мс. На границе замера оставались незавершёнными 394 задания, внешне исполнились 244 из 638 измерительных созданий; после 52.799 с drain — все 638, очередь опустела. Drain — измеренный результат, не отдельный SLA спеки. [Подробный отчёт](docs/project/nf08-presale-2026-11-11.md) и [исходный JSON](docs/project/nf08-presale-2026-11-11.json) · [матрица приёмки](docs/project/acceptance.md).

Спецификации размещаются в `docs/specs/`; при запуске передайте агенту путь к выбранной спецификации и попросите выполнить `START_PROMPT.md`. Например: `codex "Прочитай START_PROMPT.md и выполни его для спецификации <путь-к-спецификации>"`. Можно передать и другой доступный путь.

Установка агентских инструментов: `npm ci`; проверка: `npm run check:agents`. Команды проверок приложения описаны в `docs/project/quality-checks.md`. Serena и MCP необязательны.

## Windows: приложение на хосте (PowerShell)

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

После запуска эмулятора и API загрузите демонстрационный набор из корня: `node scripts/demo-seed.mjs`. Он создаёт семь заданий для Alice и Bob, воспроизводит четыре режима D07 и сохраняет операторское назначение с аудитом. Повтор команды использует прежние ключи и не создаёт дубли. Режим сбоев после загрузки сброшен.

Для демонстрации войдите под `alice` / `demo-alice` или `bob` / `demo-bob`: каждый видит только свои задания. Под `operator` / `demo-operator` откройте вкладку «Проблемы» и карточку `TASK006 Demo unavailable; operator review`: она остаётся в состоянии доставки FAILED и исполнения PENDING после пяти попыток; история доступна в карточке, а независимый `GET /operations/{operationId}` возвращает 404. Таблица ожидаемых состояний всех режимов — в [docs/project/integrations.md](docs/project/integrations.md).

Сохранён и прежний сценарий `& .\scripts\demo-seed.ps1`: он создаёт новый набор `TASK004 Demo …` при каждом запуске и намеренно оставляет режим недоступности включённым. После его выполнения сбросьте режим через `& .\scripts\emulator-mode.ps1 -Mode Reset`.

Для ручной демонстрации включайте режим перед созданием задания: `& .\scripts\emulator-mode.ps1 -Mode Unavailable`; `& .\scripts\emulator-mode.ps1 -Mode DropAfterSave`; `& .\scripts\emulator-mode.ps1 -Mode DuplicateResult`; `& .\scripts\emulator-mode.ps1 -Mode DelayedResult -DelayMs 2200`. Сброс: `& .\scripts\emulator-mode.ps1 -Mode Reset`. В таблице D07 в контракте указаны ожидаемое состояние приложения и независимый `GET /operations/{operationId}` для каждого режима.

Демо-пользователи: `alice` / `demo-alice`, `bob` / `demo-bob`, `operator` / `demo-operator`. Оператор видит область владельца alice, Bob — только свои задания. Остановите процессы в их терминалах; `docker compose stop` останавливает БД без удаления данных.

Проверки: в `backend/` — `.\mvnw.cmd -B -ntp verify` (нужен Docker для Testcontainers); из корня — `npm --prefix frontend run lint`, `npm --prefix frontend run test:styles`, `npm --prefix frontend run build`, `npm run check:agents`. Полный `& .\scripts\check-task004.ps1` на чистом временном томе сам запускает `test:browser` и `test:task004` в Chrome; путь к браузеру можно передать через `-BrowserPath` или `TASK3_BROWSER`. Для ручного запуска тестов с уже работающими сервисами используйте `npm --prefix frontend run test:browser` и `npm --prefix frontend run test:task004`.

## Linux: приложение на хосте (Bash)

Нужны Java 21, Node.js 22.12 или новее, npm, Bash, curl и работающий Docker с Compose. Запускайте команды из корня репозитория в отдельных терминалах. Сценарий проверен в отдельных Linux-контейнерах с общей host-сетью на Docker Desktop; отдельная нативная Linux-машина не использовалась.

PostgreSQL:

```bash
docker compose up -d --wait
```

Эмулятор в отдельном терминале из корня:

```bash
bash scripts/start-emulator.sh
```

API в другом терминале из корня:

```bash
bash scripts/start-backend.sh
```

Интерфейс в третьем терминале из корня:

```bash
npm --prefix frontend ci
bash scripts/start-frontend.sh
```

Скрипты используют локальные адреса и демо-пароль БД по умолчанию; при другом порте или базе задайте переменные из [конфигурации](docs/project/configuration.md). После запуска API и эмулятора из корня выполните `bash scripts/demo-seed.sh`. Этот seed использует стабильные ключи и при повторном запуске возвращает те же семь заданий; после загрузки режим сбоев сброшен. Режимы можно переключать через `bash scripts/emulator-mode.sh Unavailable`, `DropAfterSave`, `DuplicateResult`, `DelayedResult 2200` или `Reset` (имя режима передаётся первым аргументом). `EMULATOR_BASE_URL` меняет адрес эмулятора.

Остановите процессы Ctrl+C, базу — `docker compose stop`. Том при этом сохраняется.

## Полное приложение в Docker Compose

Нужен запущенный Docker с Compose. Из корня PowerShell:

```powershell
& .\scripts\docker-up.ps1
```

Из корня Bash:

```bash
bash scripts/docker-up.sh
```

Команда собирает четыре образа, ждёт healthcheck сервисов и запускает отдельный seed с семью заданиями. Повтор команды использует те же ключи создания. Обычное `docker compose -f compose.app.yaml stop` сохраняет том; `docker compose -f compose.app.yaml up -d --wait` поднимает сервисы без повторного запуска seed. Для удаления локальных данных этого Compose project используйте `docker compose -f compose.app.yaml down --volumes`: эта команда удаляет его том PostgreSQL.

Frontend доступен по `http://127.0.0.1:5173`; порты можно изменить через `APP_FRONTEND_PORT`, `APP_API_PORT` и `APP_EMULATOR_PORT`. База внутри сети Compose не опубликована на хосте. `POSTGRES_PASSWORD` задаёт локальный пароль БД; для существующего тома пароль инициализации не меняется автоматически. Для изоляции задайте `COMPOSE_PROJECT_NAME` перед запуском. Демонстрационный оператор увидит `TASK006 Demo unavailable; operator review` в списке проблем. Набор NF08 при обычном запуске не загружается.

## NF08: 5000 записей и нагрузочный профиль

Полный воспроизводимый прогон выполняется из корня после установки `JAVA_HOME` на Java 21: `& .\scripts\run-nf08.ps1 -DrainSeconds 120`. Скрипт создаёт отдельный временный Compose project и чистый том, собирает API и эмулятор, запускает PostgreSQL 17, сбрасывает все режимы сбоев, проверяет реальные `HostConfig` и cgroup-лимиты трёх контейнеров, загружает данные, запускает прогрев и измерение, а затем ограниченное ожидание внешней доставки. Генератор Node.js выполняется на хосте вне квот контейнеров; браузер не работает во время замера. После успешного прогона скрипт удаляет только собственный временный том; при ошибке оставляет среду для диагностики.

Профиль: 30 секунд прогрева, 120 секунд измерения, 20 клиентов и не более одного незавершённого запроса на клиента; четыре операции чередуются поровну: `GET /api/tasks?status=...&page=...` (20 строк на странице), `GET /api/tasks/{id}`, `POST /api/tasks` и `PATCH /api/tasks/{id}/assignee`. Используются demo-учётные записи Alice, Bob и operator с действующей областью доступа; PATCH получает эксклюзивные записи Alice и актуальную `local_version`. Профиль по умолчанию использует штатные настройки worker: задержка 1000 ms и не более 16 последовательных доставок за тик; backoff повторов сохраняется. Исторический прогон с отдельным интервалом 50 ms обозначен в отчёте и не подменяет штатный результат. Раннер записывает машинный JSON и TSV в игнорируемый `backend/target/performance/`; проверенные результаты вручную фиксируются в `docs/project/performance.md`.

Отдельная повторяемая подготовка 5000 строк выполняется командой `& .\scripts\prepare-nf08.ps1 -ProjectName <имя-проекта-nf08>` при запущенном проекте с `compose.performance.yaml`. Команда пересобирает только строки с префиксом `nf08-fixture-`, проверяет распределение Alice/Bob, связанные outbox-события, внешний ledger и область оператора, затем сохраняет список фикстур. Для обычной демонстрации используйте только небольшой набор `demo-seed.ps1` из раздела 7, а не нагрузочные фикстуры.

`npm --prefix frontend run test:session` проверяет изоляцию сессий, порядок сетевых ответов, повторное использование ключей и длинные названия в браузере с управляемыми ответами API. Для него нужен запущенный Vite и Chrome; backend не требуется.

`npm --prefix frontend run test:task004` проверяет реальную карточку при задержанном ответе эмулятора; нужны Chrome, Vite, backend, PostgreSQL и эмулятор. Полный сценарий `& .\scripts\check-task004.ps1` сам создаёт изолированный Compose project, загружает seed, останавливает backend во время обмена, перезапускает backend и PostgreSQL с тем же томом, затем удаляет только созданный им временный project/volume. Для команды требуется `JAVA_HOME` с Java 21 и свободные локальные порты 5432, 8080 и 9090.

Для дополнительных браузерных сценариев потери ответа на отдельной локальной тестовой БД задайте `$env:TASK3_POSTGRES_CONTAINER=(docker compose ps -q postgres)` перед `npm --prefix frontend run test:browser`. Тест создаёт собственные задания и временно отодвигает их повторную отправку в PostgreSQL. Не направляйте этот сценарий на общую или production-базу.

Договорённости по API и применению результатов — [docs/project/api.md](docs/project/api.md) и [docs/project/integrations.md](docs/project/integrations.md). Правила интерфейса — [docs/project/frontend.md](docs/project/frontend.md). Бизнес-допущения и известные ограничения — [docs/project/business-assumptions.md](docs/project/business-assumptions.md). При потере связи повторное создание в текущем сеансе использует тот же ключ; бизнес-результат и доставка учитываются отдельно. Внешняя проверка при сверке и локальный commit не являются распределённой транзакцией.
