# Проверки качества

Сейчас: установите зависимости агентского слоя через `npm ci`, затем запустите `npm run check:agents`.

Команды приложения сверяйте с фактическими файлами и скриптами:

- Из `backend/`: `./mvnw -B -ntp verify` (PowerShell: `.\mvnw.cmd -B -ntp verify`); интеграционным тестам нужен Docker.
- Из корня: `npm --prefix frontend ci`, `npm --prefix frontend run lint`, `npm --prefix frontend run test:styles`, `npm --prefix frontend run build`. При запущенном Vite и Chrome: `npm --prefix frontend run test:session`; сквозные `test:browser` и `test:task004` дополнительно требуют работающих backend, PostgreSQL и эмулятора.
- `& .\scripts\demo-seed.ps1` на чистом томе создаёт семь демонстрационных заданий для Alice и Bob, проверяет успешное завершение и операторскую проблему после пяти попыток, затем оставляет режим `Unavailable` включённым. После просмотра сбросьте его через `& .\scripts\emulator-mode.ps1 -Mode Reset`.
- `& .\scripts\check-task004.ps1` поднимает чистый изолированный Compose volume, запускает seed, Vite и оба браузерных набора (`test:browser`, `test:task004`), затем проверяет автоматическое восстановление только после сохранённого lease expiry и перезапускает PostgreSQL с тем же томом. После проверки скрипт удаляет только собственный временный project/volume. Нужны Docker, Java 21, Chrome и свободные порты 5432, 8080, 9090 и 5173; путь к браузеру можно передать через `-BrowserPath`.
- `& .\scripts\run-nf08.ps1 -DrainSeconds 120` создаёт отдельный performance Compose project и том, запускает измерение 30s/120s при 20 последовательных клиентах и сохраняет JSON в `backend/target/performance/`. Профиль сбрасывает режимы отказа, применяет и сверяет совокупные CPU/RAM лимиты через `docker inspect` и cgroup, запускает 5000 фикстур и удаляет только свой том после успешного отчёта.
- `& .\scripts\prepare-nf08.ps1 -ProjectName <nf08-project>` отдельно создаёт/пересоздаёт 5000 связанных записей в уже запущенной среде `compose.performance.yaml`; скрипт проверяет обе области владельцев, историю, outbox, внешний ledger и экспортирует TSV в `backend/target/performance/`.
- Docker Compose: `docker compose config`; `docker compose up -d` запускает PostgreSQL.
- Модульная архитектура Spring Boot: добавьте тест `ApplicationModules.of(Application.class).verify()` из Spring Modulith в Maven verify.
