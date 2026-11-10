import type { FormEvent } from 'react'

export function CreateTaskForm({ title, busy, onChange, onSubmit }: { title: string; busy: boolean; onChange: (title: string) => void; onSubmit: (event: FormEvent) => void }) {
  return <section className="surface create-panel"><div><h2>Новое задание</h2><p className="muted">Задание сохранится и будет передано на исполнение.</p></div><form onSubmit={onSubmit} className="create-form"><label>Название задания<input value={title} maxLength={200} required onChange={event=>onChange(event.target.value)} placeholder="Например, подготовить отчёт" /></label><button className="button button--primary" disabled={busy}>Создать задание</button></form></section>
}
