# Проверки качества

Сейчас: установите зависимости агентского слоя через `npm ci`, затем запустите `npm run check:agents`.

После появления приложения сверяйте команды с фактическими файлами и скриптами:

- Maven Wrapper и pom.xml: `./mvnw verify` (PowerShell: `.\mvnw.cmd verify`), из каталога wrapper.
- frontend/package.json: `npm --prefix frontend ci`, затем lint, build и тесты только если соответствующие скрипты объявлены в манифесте.
- Файл Docker Compose: `docker compose config`; `docker compose up -d` для необходимых локальных сервисов.
- Модульная архитектура Spring Boot: добавьте тест `ApplicationModules.of(Application.class).verify()` из Spring Modulith в Maven verify.
