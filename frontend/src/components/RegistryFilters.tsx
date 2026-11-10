export function RegistryFilters({ status, busy, onStatus, onRefresh }: { status: string; busy: boolean; onStatus: (status: string) => void; onRefresh: () => void }) {
  return <div className="filters"><label>Статус исполнения<select value={status} onChange={event=>onStatus(event.target.value)}><option value="">Все статусы</option><option value="PENDING">Ожидает</option><option value="SUCCEEDED">Выполнено</option><option value="FAILED">Ошибка</option></select></label><button className="button" disabled={busy} onClick={onRefresh}>Обновить</button></div>
}
