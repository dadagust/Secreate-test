import { useState } from 'react'
import type { Detail, OwnDetail } from '../types'
import { StatusBadge } from './StatusBadge'
import { ReconciliationPanel } from './ReconciliationPanel'

function eventLabel(event: string): string {
  if(event.startsWith('ATTEMPT_')) return `Попытка доставки ${event.slice(8)}`
  const labels: Record<string,string> = { CREATED:'Задание создано', RESULT_APPLY:'Результат применён', RESULT_DUPLICATE:'Получен повтор результата', RESULT_STALE:'Получен устаревший результат', RESULT_CONFLICT:'Обнаружен конфликт', RESULT_CONFLICT_REQUIRES_REVIEW:'Противоречивый ответ требует разбора', AMBIGUOUS_RETRY:'Ответ не получен, запланирован повтор', MANUAL_RECOVERY:'Оператор запустил восстановление', LAST_LEASE_EXPIRED:'Истёк срок последней попытки', INVALID_RESULT_REQUIRES_REVIEW:'Некорректный результат требует разбора' }
  if(event.startsWith('RECONCILIATION_DECISION_')) return 'Оператор принял решение по сверке'
  if(event.startsWith('RECONCILIATION_')) return 'Выполнена сверка'
  return labels[event] ?? event
}

export function TaskDetails({ detail, operator, busy, onClose, onRefresh, onReconcile, onApply, onRetry, onAssign }: { detail: Detail | OwnDetail; operator: boolean; busy: boolean; onClose: () => void; onRefresh: () => void; onReconcile: () => void; onApply: (id: string) => void; onRetry: () => void; onAssign: (name: string, version: number) => void }) {
  const [assignee,setAssignee] = useState('alice')
  if (!operator) { const own=detail as OwnDetail; return <section className="surface detail"><div className="section-head"><h2>{own.title}</h2><button className="button" onClick={onClose}>К реестру</button></div><p className="muted">Идентификатор: {own.id}</p><div className="facts"><span>Исполнение</span><StatusBadge value={own.status} /></div></section> }
  const task=detail as Detail
  return <section className="surface detail"><div className="section-head"><div><p className="muted">Карточка задания</p><h2>{task.title}</h2></div><div className="row"><button className="button" disabled={busy} onClick={onRefresh}>Обновить</button><button className="button" onClick={onClose}>К реестру</button></div></div>
    <p className="muted identifier">{task.id}</p><div className="facts"><span>Доставка <StatusBadge value={task.delivery_state} /></span><span>Исполнение <StatusBadge value={task.business_status} /></span><span>Ответственный: {task.assignee ?? 'Не назначен'}</span></div>{task.failure_reason && <p className="notice notice--error">Причина проблемы: {task.failure_reason}</p>}
    <div className="detail-grid"><section><h3>Действия</h3><div className="stack"><button className="button button--primary" disabled={busy} onClick={onReconcile}>Сверить результат</button><button className="button" disabled={busy || task.result_version > 0 || task.recovery_pending || !['READY','FAILED','REVIEW'].includes(task.delivery_state) || Boolean(task.lease_until && Date.parse(task.lease_until)>Date.now())} onClick={onRetry}>Повторить доставку</button><label>Новый ответственный<select value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="alice">Алиса</option><option value="bob">Боб</option><option value="operator">Оператор</option></select></label><button className="button" disabled={busy} onClick={()=>onAssign(assignee,task.local_version)}>Назначить</button></div></section>
      <ReconciliationPanel snapshots={task.reconciliations} busy={busy} onApply={onApply}/></div>
    <div className="detail-grid"><section><h3>История обмена</h3>{task.history.length ? <ul className="record-list">{task.history.map(e=><li key={e.id}><strong>{eventLabel(e.event)}</strong><br/><span className="muted">{e.actor} · {new Date(e.created_at).toLocaleString('ru-RU', { timeZone:'UTC' })} UTC</span></li>)}</ul> : <p className="muted">Событий пока нет.</p>}</section><section><h3>Конфликты</h3>{task.conflicts.length ? <ul className="record-list">{task.conflicts.map(c=><li key={c.id}>{c.reason}: версии {c.current_version} и {c.incoming_version}</li>)}</ul> : <p className="muted">Конфликтов нет.</p>}<h3 className="section-subheading">История назначения</h3>{task.assignmentHistory.length ? <ul className="record-list">{task.assignmentHistory.map(a=><li key={a.id}>{a.old_assignee ?? 'Не назначен'} → {a.new_assignee}<br/><span className="muted">{a.actor} · {new Date(a.created_at).toLocaleString('ru-RU',{timeZone:'UTC'})} UTC</span></li>)}</ul> : <p className="muted">Изменений пока нет.</p>}</section></div>
  </section>
}
