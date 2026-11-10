# Backend

Цель: Java и Spring Boot, PostgreSQL. Приложение и Maven Wrapper пока отсутствуют. После их появления из корня запускайте './mvnw verify' (PowerShell: '.\mvnw.cmd verify'), либо wrapper из каталога, где он установлен. Для модульной архитектуры добавьте тест Spring Modulith: 'ApplicationModules.of(Application.class).verify()'; он проверяет циклы и доступ к внутренним пакетам. Включите тест в Maven verify. Схему БД меняйте версионируемыми миграциями; проверяйте совместимость и доступ к данным. Для интеграционных проверок используйте PostgreSQL через Docker Compose после появления compose-файла.

