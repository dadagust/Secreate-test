# Backend

Стек: Java 21, Spring Boot и PostgreSQL. В каталоге backend создан Maven Wrapper; из него запускайте `./mvnw verify` (PowerShell: `.\mvnw.cmd verify`). Для теста контекста необходим Docker: Testcontainers запускает PostgreSQL. Для модульной архитектуры добавьте тест Spring Modulith `ApplicationModules.of(Application.class).verify()` в Maven verify. Схему БД меняйте версионируемыми миграциями; проверяйте совместимость и доступ к данным. Запуск приложения описан в корневом README; незавершённые требования — в PROGRESS.md.

