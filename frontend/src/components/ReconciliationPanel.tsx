import type { Snapshot } from '../types'
import { StatusBadge } from './StatusBadge'

export function ReconciliationPanel({ snapshots, busy, onApply }: { snapshots: Snapshot[]; busy: boolean; onApply: (id: string) => void }) {
  return <section><h3>Сверка</h3>{snapshots.length === 0 ? <p className="muted">Сверка ещё не выполнялась.</p> : <ul className="record-list">{snapshots.map(s=><li key={s.id}><div><StatusBadge value={s.outcome} /> <span className="muted">{s.actor} · {new Date(s.observed_at).toLocaleString('ru-RU', { timeZone: 'UTC' })} UTC</span></div><p>Внешний результат: {s.external_status ? <StatusBadge value={s.external_status} /> : 'нет данных'}{s.external_version !== null ? `, версия ${s.external_version}` : ''}</p>{s.invalid_reason && <p>Причина: {s.invalid_reason}</p>}{!s.decision && s.outcome === 'DIFFERENT' && <button className="button" disabled={busy} onClick={()=>onApply(s.id)}>Принять внешний результат</button>}</li>)}</ul>}</section>
}
