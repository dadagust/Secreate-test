# Проверки качества

Сейчас: установите зависимости агентского слоя через `npm ci`, затем запустите `npm run check:agents`.

Команды приложения сверяйте с фактическими файлами и скриптами:

## Windows (PowerShell)

- Из `backend/`: `.\mvnw.cmd -B -ntp verify`; интеграционным тестам нужен Docker.
- Из корня: `npm --prefix frontend ci`, `npm --prefix frontend run lint`, `npm --prefix frontend run test:styles`, `npm --prefix frontend run build`. При запущенном Vite и Chrome: `npm --prefix frontend run test:session`; сквозные `test:browser` и `test:task004` дополнительно требуют работающих backend, PostgreSQL и эмулятора.
- `& .\scripts\demo-seed.ps1` на чистом томе создаёт семь демонстрационных заданий для Alice и Bob, проверяет успешное завершение и операторскую проблему после пяти попыток, затем оставляет режим `Unavailable` включённым. После просмотра сбросьте его через `& .\scripts\emulator-mode.ps1 -Mode Reset`.
- `& .\scripts\check-task004.ps1` поднимает чистый изолированный Compose volume, запускает seed, Vite и оба браузерных набора (`test:browser`, `test:task004`), затем проверяет автоматическое восстановление только после сохранённого lease expiry и перезапускает PostgreSQL с тем же томом. После проверки скрипт удаляет только собственный временный project/volume. Нужны Docker, Java 21, Chrome и свободные порты 5432, 8080, 9090 и 5173; путь к браузеру можно передать через `-BrowserPath`.
- `& .\scripts\run-nf08.ps1 -DrainSeconds 120` создаёт отдельный performance Compose project и том, запускает измерение 30s/120s при 20 последовательных клиентах и сохраняет JSON в `backend/target/performance/`. Профиль сбрасывает режимы отказа, применяет и сверяет совокупные CPU/RAM лимиты через `docker inspect` и cgroup, запускает 5000 фикстур и удаляет только свой том после успешного отчёта. Штатная конфигурация — fixed delay 1000 мс и batch до 16; параметры доступны через `-WorkerPollIntervalMs` и `-WorkerMaxItemsPerTick`.
- `& .\scripts\prepare-nf08.ps1 -ProjectName <nf08-project>` отдельно создаёт/пересоздаёт 5000 связанных записей в уже запущенной среде `compose.performance.yaml`; скрипт проверяет обе области владельцев, историю, outbox, внешний ledger и экспортирует TSV в `backend/target/performance/`.
- Docker Compose: `docker compose config`; `docker compose up -d` запускает PostgreSQL.
- Модульная архитектура Spring Boot: добавьте тест `ApplicationModules.of(Application.class).verify()` из Spring Modulith в Maven verify.

## Linux (Bash)

Установите зависимости отдельно на Linux: `npm ci` в корне и `npm --prefix frontend ci`. Из `backend/` используйте `sh ./mvnw -B -ntp verify` с Java 21 и Docker/Testcontainers. Из корня выполняйте `npm --prefix frontend run lint`, `npm --prefix frontend run test:styles`, `npm --prefix frontend run build` и `npm run check:agents`.

`bash scripts/check-task004.sh` создаёт собственный Compose project и том, запускает демоданные с четырьмя режимами, останавливает backend при активном lease после внешнего commit, затем перезапускает PostgreSQL с тем же томом и сравнивает историю и аудит. Через trap он собирает логи при ошибке и удаляет только созданный им project. Требуются Bash, Docker с Compose, Node.js, curl и `setsid` из util-linux или BusyBox. При запуске из отдельного контейнера Docker Desktop передайте `TASK004_RUNNER_IN_COMPOSE_NETWORK=1`; сценарий подключит runner к своему Compose network и использует сервисные имена.

Для `test:session`, `test:browser` и `test:task004` задайте путь к Chrome/Chromium, например `export TASK3_BROWSER=/usr/bin/chromium`, и запустите frontend и нужные сервисы согласно README. `test:browser` использует локальные порты 5173 и 9090. Дополнительные проверки потери ответа включаются через `TASK3_POSTGRES_CONTAINER` и изменяют тестовые задания в указанной БД; используйте изолированный проект.

`bash scripts/prepare-nf08.sh nf08-example` подготавливает 5000 записей существующего performance project; имя должно содержать только строчные латинские буквы, цифры и дефис. `bash scripts/run-nf08.sh` создаёт отдельный проект, проверяет лимиты HostConfig/cgroup и по умолчанию запускает профиль со штатными 1000 мс и 16 элементами на тик. Значения можно задать через `NF08_WORKER_POLL_MS` и `NF08_WORKER_MAX_ITEMS_PER_TICK`; 50 мс требуется указывать явно только для сопоставления с историческими специальными прогонами. Нужны Java 21, Maven Wrapper, Node.js/npm, Bash, curl, `setsid` и Docker; JSON и TSV создаются в `backend/target/performance/` с уникальным идентификатором. При ошибке раннер печатает логи и удаляет только свой project и том.

`node --test scripts/performance/*test.mjs` отдельно проверяет пересечение внешних исполнений и локально незавершённых доставок, валидность NF08, сохранение JSON перед ошибкой при пустых выборках/массовых отказах, а также сводку фазовых времён.

Для Linux-раннера внутри Docker Desktop соберите `docker build -t secreate-nf08-runner -f scripts/Dockerfile.nf08-runner .`. Для lifecycle примонтируйте Docker socket и рабочее дерево и задайте внутреннюю сеть: `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD:/workspace" -w /workspace -e TASK004_RUNNER_IN_COMPOSE_NETWORK=1 secreate-nf08-runner bash scripts/check-task004.sh`. Для NF08 используйте тот же образ, задав `NF08_RUNNER_IN_COMPOSE_NETWORK=1`, `NF08_WORKER_POLL_MS=1000`, `NF08_WORKER_MAX_ITEMS_PER_TICK=16` и `NF08_DRAIN_SECONDS=120`, затем запустите `bash scripts/run-nf08.sh`. Runner не получает CPU/RAM лимит профиля; эти лимиты применяются только к backend, PostgreSQL и эмулятору.

Для воспроизведения Linux Maven/Testcontainers внутри контейнера Docker Desktop можно собрать `docker build -f Dockerfile.app --target backend-check -t secreate-backend-check .`, затем выполнить `docker run --rm --network host -v /var/run/docker.sock:/var/run/docker.sock -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal secreate-backend-check`. В этой среде `127.0.0.1` не позволил Testcontainers подключиться к Ryuk; `host.docker.internal` позволил выполнить Maven verify (TASK-007: 31 тест, 0 ошибок/пропусков). Это настройка вложенного запуска на Docker Desktop, а не обязательная переменная для обычного Linux-хоста.

Цели `frontend-check`, `agent-check` и `browser-check` в `Dockerfile.app` предназначены для изолированных Linux-проверок. Первые две выполняют чистый `npm ci` и соответствующие проверки при сборке: `docker build -f Dockerfile.app --target frontend-check .` и `docker build -f Dockerfile.app --target agent-check .`. Для браузерного образа запустите изолированное приложение, затем `docker build -f Dockerfile.app --target browser-check -t secreate-browser-check .` и `docker run --rm --network host --shm-size=1g secreate-browser-check npm run test:session`. Для полного `test:browser` с проверкой PostgreSQL дополнительно передайте Docker socket и `-e TASK3_POSTGRES_CONTAINER=<имя-изолированного-контейнера>`. `test:task004` запускается тем же образом после завершения других сценариев, поскольку меняет режимы эмулятора.


## Регрессии предсдаточной проверки

На Windows из PowerShell выполните `& .\scripts\check-demo-seed.ps1`: скрипт создаёт уникальный Compose project, проверяет прерывание после доставки до назначения, возобновление с тем же ID, повтор seed и неизменность пользовательского задания с тем же владельцем и заголовком. Он удаляет только созданный project и его том.

На Windows и Linux запустите модульные регрессии: `node --test scripts/demo-seed-identity.test.mjs scripts/performance/nf08-profile-validation.test.mjs scripts/performance/nf08-counts.test.mjs`. Linux Maven Wrapper запускается из `backend/` командой `sh ./mvnw -B -ntp verify`, включая архивы без executable bit.
