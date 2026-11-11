import type { User } from './types'

const storageKey = 'secreate.demo-session.v1'
const users = new Set<User>(['alice', 'bob', 'operator'])

export type DemoSession = { user: User; password: string }

export function readDemoSession(storage: Storage = window.sessionStorage): DemoSession | null {
  try {
    const raw = storage.getItem(storageKey)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && 'user' in value && 'password' in value) {
      const session = value as Record<string, unknown>
      if (users.has(session.user as User) && typeof session.password === 'string' && session.password.length > 0) {
        return { user: session.user as User, password: session.password }
      }
    }
    storage.removeItem(storageKey)
  } catch {
    try { storage.removeItem(storageKey) } catch { /* Storage may be unavailable. */ }
  }
  return null
}

export function writeDemoSession(session: DemoSession, storage: Storage = window.sessionStorage): void {
  try { storage.setItem(storageKey, JSON.stringify(session)) } catch { /* Keep the in-memory login usable when storage is disabled. */ }
}

export function clearDemoSession(storage: Storage = window.sessionStorage): void {
  try { storage.removeItem(storageKey) } catch { /* Storage may be unavailable. */ }
}
