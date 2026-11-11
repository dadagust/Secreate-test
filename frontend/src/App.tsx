import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, request } from './api'
import type { Detail, OwnDetail, Page, User } from './types'
import { Login } from './components/Login'
import { TaskRegistry } from './components/TaskRegistry'
import { TaskDetails } from './components/TaskDetails'
import { CreateTaskForm } from './components/CreateTaskForm'
import { RegistryFilters } from './components/RegistryFilters'
import { parseWorkspaceRoute, writeWorkspaceRoute } from './navigation'
import type { WorkspaceRoute } from './navigation'
import { clearDemoSession, readDemoSession, writeDemoSession } from './session'

type Credentials = { user: User; password: string }

export default function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)

  useEffect(() => {
    let active = true
    const saved = readDemoSession()
    if (!saved) {
      setSessionReady(true)
      return () => { active = false }
    }

    void request<Page>(saved.user, saved.password, '/api/tasks?page=0')
      .then(() => { if (active) setCredentials(saved) })
      .catch((error: unknown) => {
        if (!active) return
        if (error instanceof ApiError && error.status === 401) {
          clearDemoSession()
          setLoginError('Сохранённый вход больше не действует. Войдите снова.')
        } else {
          // Keep the tab session if the server is temporarily unavailable.
          setCredentials(saved)
        }
      })
      .finally(() => { if (active) setSessionReady(true) })

    return () => { active = false }
  }, [])

  async function login(user: User, password: string) {
    setLoginBusy(true)
    setLoginError('')
    try {
      await request<Page>(user, password, '/api/tasks?page=0')
      writeDemoSession({ user, password })
      setCredentials({ user, password })
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Не удалось войти.')
    } finally {
      setLoginBusy(false)
    }
  }

  function logout() {
    clearDemoSession()
    setCredentials(null)
    setLoginError('')
    setLoginBusy(false)
  }

  if (!sessionReady) return <main className="login-shell"><section className="surface login-panel" role="status">Восстанавливаем вход…</section></main>
  if (!credentials) return <Login onLogin={login} error={loginError} busy={loginBusy} />
  return <Workspace key={credentials.user} credentials={credentials} onLogout={logout} />
}

function Workspace({ credentials, onLogout }: { credentials: Credentials; onLogout: () => void }) {
  const [error, setError] = useState('')
  const [listBusy, setListBusy] = useState(false)
  const [detailBusy, setDetailBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [data, setData] = useState<Page | null>(null)
  const [route, setRoute] = useState<WorkspaceRoute>(() => {
    const initial = parseWorkspaceRoute(window.location)
    return credentials.user === 'operator' ? initial : { ...initial, problems: false }
  })
  const [revision, setRevision] = useState(0)
  const [detail, setDetail] = useState<Detail | OwnDetail | null>(null)
  const [title, setTitle] = useState('')
  const creation = useRef<{ title: string; key: string } | null>(null)
  const retryKeys = useRef<Record<string, { key: string; failure: number | string }>>({})
  const alive = useRef(false)
  const actionBusyRef = useRef(false)
  const selectedRef = useRef(route.selected)
  const listSequence = useRef(0)
  const detailSequence = useRef(0)
  const { selected, problems, page, status } = route
  const operator = credentials.user === 'operator'
  const busy = detailBusy || actionBusy

  useEffect(() => {
    alive.current = true
    const syncFromLocation = () => {
      const parsed = parseWorkspaceRoute(window.location)
      const next = operator ? parsed : { ...parsed, problems: false }
      listSequence.current++
      detailSequence.current++
      selectedRef.current = next.selected
      setRoute(next)
      setData(null)
      setDetail(null)
      setListBusy(false)
      setDetailBusy(Boolean(next.selected))
      setError('')
    }

    window.addEventListener('popstate', syncFromLocation)
    writeWorkspaceRoute(route, true)
    return () => {
      alive.current = false
      listSequence.current++
      detailSequence.current++
      window.removeEventListener('popstate', syncFromLocation)
    }
  }, [])

  function changeRoute(next: WorkspaceRoute, replace = false) {
    listSequence.current++
    if (next.selected !== selectedRef.current) {
      detailSequence.current++
      selectedRef.current = next.selected
      setDetail(null)
      setDetailBusy(Boolean(next.selected))
    }
    setListBusy(false)
    setData(null)
    setError('')
    setRoute(next)
    writeWorkspaceRoute(next, replace)
  }

  const load = useCallback(async (silent = false) => {
    if (selected) return
    const sequence = ++listSequence.current
    if (!silent) {
      setListBusy(true)
      setError('')
    }
    try {
      const query = new URLSearchParams({ page: String(page) })
      if (status) query.set('status', status)
      const endpoint = problems && operator ? '/api/operator/tasks/problems' : '/api/tasks'
      const result = await request<Page>(credentials.user, credentials.password, `${endpoint}?${query}`)
      if (alive.current && sequence === listSequence.current && selectedRef.current === null) {
        setData(result)
        if (silent) setError('')
      }
    } catch (loadError) {
      if (alive.current && sequence === listSequence.current && selectedRef.current === null) {
        setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить задания.')
      }
    } finally {
      if (alive.current && sequence === listSequence.current && !silent) setListBusy(false)
    }
  }, [credentials, page, status, problems, operator, selected, revision])

  useEffect(() => {
    if (selected) return
    void load()
    const timer = window.setInterval(() => { void load(true) }, 5000)
    return () => {
      window.clearInterval(timer)
      listSequence.current++
    }
  }, [load, selected])

  const refreshDetail = useCallback(async (id: string, showLoading = false) => {
    const sequence = ++detailSequence.current
    if (showLoading) {
      setDetail(null)
      setDetailBusy(true)
    }
    try {
      const result = await request<Detail | OwnDetail>(credentials.user, credentials.password, operator ? `/api/operator/tasks/${id}` : `/api/tasks/${id}`)
      if (alive.current && sequence === detailSequence.current && selectedRef.current === id) {
        setDetail(result)
        setError('')
      }
    } catch (detailError) {
      if (alive.current && sequence === detailSequence.current && selectedRef.current === id) {
        setError(detailError instanceof Error ? detailError.message : 'Не удалось открыть задание.')
      }
    } finally {
      if (showLoading && alive.current && sequence === detailSequence.current && selectedRef.current === id) setDetailBusy(false)
    }
  }, [credentials, operator])

  useEffect(() => {
    if (!selected) return
    const id = selected
    void refreshDetail(id, true)
    const timer = window.setInterval(() => {
      if (!actionBusyRef.current) void refreshDetail(id)
    }, 5000)
    return () => {
      window.clearInterval(timer)
      detailSequence.current++
    }
  }, [selected, refreshDetail])

  function open(id: string) {
    changeRoute({ ...route, selected: id })
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    actionBusyRef.current = true
    setActionBusy(true)
    setError('')
    try {
      if (!creation.current || creation.current.title !== title) creation.current = { title, key: crypto.randomUUID() }
      const result = await request<OwnDetail>(credentials.user, credentials.password, '/api/tasks', {
        method: 'POST',
        headers: { 'Idempotency-Key': creation.current.key },
        body: JSON.stringify({ title }),
      })
      if (!alive.current) return
      creation.current = null
      setTitle('')
      changeRoute({ ...route, selected: result.id })
      setRevision(value => value + 1)
    } catch (createError) {
      if (alive.current) setError(createError instanceof Error ? createError.message : 'Не удалось создать задание.')
    } finally {
      actionBusyRef.current = false
      if (alive.current) setActionBusy(false)
    }
  }

  async function mutate(path: string, options: RequestInit) {
    if (!selected) return
    const id = selected
    actionBusyRef.current = true
    setActionBusy(true)
    setError('')
    try {
      await request(credentials.user, credentials.password, path, options)
      if (alive.current && selectedRef.current === id) {
        await refreshDetail(id)
        if (alive.current && selectedRef.current === id) setRevision(value => value + 1)
      }
    } catch (mutationError) {
      if (alive.current && selectedRef.current === id) setError(mutationError instanceof Error ? mutationError.message : 'Не удалось выполнить действие.')
    } finally {
      actionBusyRef.current = false
      if (alive.current) setActionBusy(false)
    }
  }

  function close() {
    changeRoute({ ...route, selected: null })
  }

  function logout() {
    clearDemoSession()
    writeWorkspaceRoute({ selected: null, problems: false, page: 0, status: '' }, true)
    alive.current = false
    actionBusyRef.current = false
    listSequence.current++
    detailSequence.current++
    selectedRef.current = null
    onLogout()
  }

  return <><header className="topbar"><div className="container topbar-inner"><div><strong className="brand">Обмен заданий</strong><span className="topbar-subtitle">Рабочее пространство</span></div><div className="row"><span>{operator ? 'Оператор' : `Инициатор: ${credentials.user}`}</span><button className="button" onClick={logout}>Выйти</button></div></div></header>
    <main className="container main-stack"><div className="page-heading"><div><p className="muted">Обзор и управление</p><h1>{operator ? 'Рабочая консоль' : 'Мои задания'}</h1><p className="muted">{operator ? 'Контролируйте доставку и результаты обмена.' : 'Создавайте задания и следите за исполнением.'}</p></div></div>
      {error && <div className="notice notice--error" role="alert">{error} {selected && <button className="link-button" onClick={() => void refreshDetail(selected, true)}>Обновить данные</button>}</div>}
      {selected ? detail ? <TaskDetails key={selected} detail={detail} operator={operator} busy={busy} onClose={close} onRefresh={() => void refreshDetail(selected, true)} onReconcile={() => void mutate(`/api/operator/tasks/${selected}/reconcile`, { method: 'POST' })} onApply={id => { if (window.confirm('Принять внешний результат?')) void mutate(`/api/operator/tasks/${selected}/reconciliations/${id}/apply`, { method: 'POST' }) }} onRetry={() => {
        const history = (detail as Detail).history
        const failure = history.filter(event => ['AMBIGUOUS_RETRY', 'LAST_LEASE_EXPIRED', 'INVALID_RESULT_REQUIRES_REVIEW', 'RESULT_CONFLICT', 'RESULT_CONFLICT_REQUIRES_REVIEW'].includes(event.event)).at(-1)?.id ?? 0
        const previous = retryKeys.current[selected]
        if (!previous || previous.failure !== failure) retryKeys.current[selected] = { key: crypto.randomUUID(), failure }
        void mutate(`/api/operator/tasks/${selected}/retry`, { method: 'POST', headers: { 'Idempotency-Key': retryKeys.current[selected].key } })
      }} onAssign={(assignee, version) => void mutate(`/api/tasks/${selected}/assignee`, { method: 'PATCH', body: JSON.stringify({ assignee, version }) })} /> : <section className="surface detail">{detailBusy ? <p role="status">Загрузка карточки…</p> : <button className="button" onClick={close}>К реестру</button>}</section> : <>
        {!operator && <CreateTaskForm title={title} busy={busy} onChange={setTitle} onSubmit={create} />}
        <section className="surface registry"><div className="section-head"><div><h2>{problems && operator ? 'Проблемы обмена' : 'Реестр заданий'}</h2><p className="muted">Доставка и исполнение отслеживаются отдельно.</p></div>{operator && <div className="tabs"><button className={!problems ? 'button button--selected' : 'button'} onClick={() => changeRoute({ ...route, problems: false, page: 0, selected: null })}>Все задания</button><button className={problems ? 'button button--selected' : 'button'} onClick={() => changeRoute({ ...route, problems: true, page: 0, selected: null })}>Проблемы</button></div>}</div><RegistryFilters status={status} busy={listBusy} onStatus={value => changeRoute({ ...route, status: value, page: 0 })} onRefresh={() => void load()} />{listBusy && <p className="muted" role="status">Загрузка…</p>}{data && <TaskRegistry data={data} onOpen={open} onPage={value => changeRoute({ ...route, page: value })} />}</section>
      </>}
    </main></>
}
