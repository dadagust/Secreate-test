import { useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '../types'
export function Login({ onLogin, error, busy }: { onLogin: (user: User, password: string) => void; error: string; busy: boolean }) {
  const [user, setUser] = useState<User>('alice')
  const [password, setPassword] = useState('')
  function submit(event: FormEvent) { event.preventDefault(); onLogin(user,password) }
  return <main className="login-shell"><section className="surface login-panel"><p className="brand">Обмен заданий</p><h1>Вход в систему</h1><p className="muted">Выберите демонстрационного пользователя и введите пароль.</p><form className="stack" onSubmit={submit}>
    <label>Пользователь<select value={user} onChange={e => setUser(e.target.value as User)}><option value="alice">Алиса — инициатор</option><option value="bob">Боб — инициатор</option><option value="operator">Оператор</option></select></label>
    <label>Пароль<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
    {error && <p className="notice notice--error" role="alert">{error}</p>}
    <button className="button button--primary" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
  </form></section></main>
}
