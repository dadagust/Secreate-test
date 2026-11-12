# API и контракты

`GET /api/tasks?status=PENDING&page=0` возвращает `{items,page,hasNext}`; страница содержит до 20 записей. Фильтр `status` принимает PENDING, SUCCEEDED или FAILED. Порядок — `created_at DESC, id DESC`. Инициатор видит свои задания, оператор — только владельцев из `operator_scope`. `GET /api/operator/tasks/problems` использует те же фильтр и пагинацию после отбора проблем.

`GET /api/tasks/{id}` возвращает карточку инициатора и доступен только владельцу. `POST /api/tasks` доступен роли INITIATOR; тело `{"title":"..."}`, заголовок `Idempotency-Key` длиной 1–200 символов. Повтор ключа с тем же содержимым возвращает исходное задание; другое тело для того же ключа даёт 409. В NF08 используется ровно этот create API с уникальным ключом каждого запроса.

`PATCH /api/tasks/{id}/assignee` доступен оператору в его области. Тело: `{"assignee":"operator","version":0}`. Версия относится к локальным назначениям и не связана с версией внешнего результата. Устаревшая версия возвращает 409; изменение и запись старого и нового ответственного, автора и времени в `assignment_audit` атомарны. Для демонстрации допустимы `alice`, `bob`, `operator`.

Создание, карточка оператора, сверка и восстановление описаны в [контракте обмена](./integrations.md).

Карточка `GET /api/operator/tasks/{id}` включает `history[]` с `id`, `task_id`, `event`, `actor`, `created_at` и объектом `details`. Например, применённый результат содержит `oldBusinessStatus`, `newBusinessStatus`, `oldResultVersion`, `newResultVersion`, `incomingBusinessStatus`, `incomingResultVersion`, `resultDecision`, `oldDeliveryState` и `newDeliveryState`. События повтора, попытки и сверки содержат соответствующие лимиты/попытки, исход и идентификатор reconciliation snapshot. Ключи идемпотентности и сырые тела внешнего ответа в `details` не записываются. История доступна только оператору в его `operator_scope`; инициаторский API её не возвращает.

Локальный D07 API отдельного эмулятора по умолчанию слушает `127.0.0.1:9090` и не имеет аутентификации: `PUT /fault-modes/unavailable`, `/drop-after-save`, `/duplicate-result`, `/delayed-result?delayMs=1..2500`; `GET /fault-modes` читает настройки; `DELETE /fault-modes` сбрасывает их. Недоступность действует до сброса; потеря ответа, дубликат и задержка применяются к следующему успешному POST и выключаются атомарно вместе с фиксацией результата. Фактическое внешнее состояние независимо проверяется через `GET /operations/{operationId}`. В Compose эмулятор может слушать внутренний интерфейс контейнера, но published port привязан к `127.0.0.1`; не публикуйте служебный порт за пределы loopback.

`executor.executions.executed_at` — UTC-момент первой фиксации внешней операции в PostgreSQL; конфликтный повтор не меняет его. NF08 вычитает `tasks.created_at` из этого значения. Эмулятор использует тот же экземпляр PostgreSQL, но отдельную схему `executor` и отдельный процесс.
