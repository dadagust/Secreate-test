import type { User } from './types'
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export async function request<T>(user: User, password: string, path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Basic ${btoa(`${user}:${password}`)}`)
  if (options.body) headers.set('Content-Type', 'application/json')
  let response: Response
  try { response = await fetch(path, { ...options, headers }) }
  catch { throw new ApiError(0, 'Нет связи с сервером. Проверьте подключение и повторите попытку.') }
  if (!response.ok) {
    let message = ''
    try { const data = await response.json() as { message?: string }; message = data.message || '' } catch { /* non-JSON error */ }
    const translated: Record<string,string> = {
      'Snapshots changed; reconcile again': 'Данные сверки изменились. Обновите карточку и выполните сверку снова.',
      'Local state changed; reconcile again': 'Данные задания изменились. Обновите карточку и выполните сверку снова.',
      'New reconciliation required': 'Требуется новая сверка. Обновите карточку и выполните сверку снова.',
      'Active lease; reconcile again': 'Доставка выполняется. Обновите карточку и повторите сверку позже.',
      'External version cannot be applied': 'Внешнюю версию нельзя применить автоматически. Обновите карточку и разберите расхождение.',
      'Recovery already scheduled': 'Восстановление уже запланировано. Обновите карточку.',
      'Recovery not permitted': 'Повтор для текущего состояния недоступен. Обновите карточку.',
      'Active lease': 'Доставка уже выполняется. Обновите карточку позже.',
      'Key reused': 'Ключ запроса уже использован для другого действия. Обновите карточку.',
    }
    message = translated[message] ?? message
    throw new ApiError(response.status, message || (response.status === 409 ? 'Данные изменились или действие недоступно. Обновите карточку.' : response.status === 401 ? 'Неверное имя пользователя или пароль.' : response.status === 403 ? 'У вас нет прав на это действие.' : response.status === 404 ? 'Задание недоступно.' : `Ошибка сервера: ${response.status}`))
  }
  return await response.json() as T
}
