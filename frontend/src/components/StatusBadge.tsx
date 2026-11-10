const labels: Record<string,string> = { PENDING:'Ожидает', SUCCEEDED:'Выполнено', FAILED:'Ошибка', READY:'Ожидает доставки', DONE:'Доставлено', REVIEW:'Требует разбора', MATCH:'Совпадает', DIFFERENT:'Расхождение', ABSENT:'Не найдено', UNAVAILABLE:'Недоступен', INVALID:'Некорректный ответ' }
export function StatusBadge({ value }: { value: string }) {
  const tone = ['SUCCEEDED','DONE','MATCH'].includes(value) ? 'success' : ['FAILED','REVIEW','DIFFERENT','INVALID'].includes(value) ? 'danger' : 'neutral'
  return <span className={`status status--${tone}`}>{labels[value] ?? value}</span>
}
