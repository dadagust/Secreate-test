import type { Page, Task } from '../types'
import { StatusBadge } from './StatusBadge'
export function TaskRegistry({ data, onOpen, onPage }: { data: Page; onOpen: (id: string) => void; onPage: (page: number) => void }) {
  if (!data.items.length) return <div className="empty"><p>Заданий по выбранному фильтру нет.</p>{data.page>0 && <button className="button" onClick={()=>onPage(data.page-1)}>На предыдущую страницу</button>}</div>
  const action = (task: Task) => <button className="link-button" onClick={() => onOpen(task.id)}>{task.title}</button>
  return <><div className="table-wrap"><table><thead><tr><th>Задание</th><th>Владелец</th><th>Доставка</th><th>Исполнение</th><th>Ответственный</th></tr></thead><tbody>{data.items.map(task => <tr key={task.id}><td>{action(task)}</td><td>{task.owner_name}</td><td><StatusBadge value={task.delivery_state} /></td><td><StatusBadge value={task.business_status} /></td><td>{task.assignee ?? 'Не назначен'}</td></tr>)}</tbody></table></div>
    <div className="mobile-list">{data.items.map(task => <article className="task-card" key={task.id}>{action(task)}<dl><div><dt>Владелец</dt><dd>{task.owner_name}</dd></div><div><dt>Доставка</dt><dd><StatusBadge value={task.delivery_state} /></dd></div><div><dt>Исполнение</dt><dd><StatusBadge value={task.business_status} /></dd></div><div><dt>Ответственный</dt><dd>{task.assignee ?? 'Не назначен'}</dd></div></dl></article>)}</div>
    <nav className="pagination" aria-label="Страницы"><button className="button" disabled={data.page === 0} onClick={() => onPage(data.page-1)}>Назад</button><span>Страница {data.page+1}</span><button className="button" disabled={!data.hasNext} onClick={() => onPage(data.page+1)}>Далее</button></nav></>
}
