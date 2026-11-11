// Repeatable demo data through the same HTTP APIs used by the application.
import { createSeedTask } from './demo-seed-identity.mjs'
const api = (process.env.DEMO_API_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const emulator = (process.env.DEMO_EMULATOR_URL ?? 'http://127.0.0.1:9090').replace(/\/$/, '')
const passwords = { alice: 'demo-alice', bob: 'demo-bob', operator: 'demo-operator' }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function request(base, path, { user, method = 'GET', key, body, expected = 200 } = {}) {
  const headers = {}
  if (user) headers.Authorization = `Basic ${Buffer.from(`${user}:${passwords[user]}`).toString('base64')}`
  if (key) headers['Idempotency-Key'] = key
  if (body) headers['Content-Type'] = 'application/json'
  const response = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) })
  const text = await response.text()
  if (response.status !== expected) throw new Error(`${method} ${path}: HTTP ${response.status}: ${text.slice(0, 300)}`)
  return text && expected !== 404 ? JSON.parse(text) : null
}
const reset = () => request(emulator, '/fault-modes', { method: 'DELETE', expected: 204 })
const mode = (path) => request(emulator, `/fault-modes/${path}`, { method: 'PUT', expected: 204 })
const detail = (id) => request(api, `/api/operator/tasks/${id}`, { user: 'operator' })
const external = (id) => request(emulator, `/operations/${id}`)

async function until(label, query, predicate, timeoutMs = 50000) {
  const deadline = Date.now() + timeoutMs
  do {
    const value = await query()
    if (predicate(value)) return value
    await sleep(200)
  } while (Date.now() < deadline)
  throw new Error(`Истекло ожидание: ${label}`)
}

async function create(owner, slug, title, fault) {
  return createSeedTask({
    owner,
    slug,
    title,
    fault,
    setFaultMode: async (modeName) => {
      await reset()
      if (modeName) await mode(modeName)
    },
    postTask: (taskOwner, key, taskTitle) => request(api, '/api/tasks', {
      user: taskOwner, method: 'POST', key, body: { title: taskTitle },
    }),
  })
}

const scenarios = [
  ['alice', 'regular', 'TASK006 Demo standard delivery Alice', null],
  ['bob', 'bob', 'TASK006 Demo second initiator Bob', null],
  ['alice', 'offline', 'TASK006 Demo unavailable then recovery', 'unavailable'],
  ['alice', 'lost', 'TASK006 Demo reply lost after commit', 'drop-after-save'],
  ['alice', 'duplicate', 'TASK006 Demo duplicate result', 'duplicate-result'],
  ['alice', 'delayed', 'TASK006 Demo delayed result', 'delayed-result?delayMs=2200'],
  ['alice', 'problem', 'TASK006 Demo unavailable; operator review', 'unavailable'],
]

try {
  await reset()
  for (const [owner, slug, title, fault] of scenarios) {
    const task = await create(owner, slug, title, fault)
    if (slug === 'bob') {
      const current = await request(api, `/api/tasks/${task.id}`, { user: owner })
      if (current.status === 'PENDING') await until(title, () => request(api, `/api/tasks/${task.id}`, { user: owner }), (state) => state.status === 'SUCCEEDED')
      else if (current.status !== 'SUCCEEDED') throw new Error(`${title}: expected SUCCEEDED, found ${current.status}; seed will not overwrite it`)
      if ((await external(task.id)).executions !== 1) throw new Error(`${title}: expected external executions=1`)
    } else if (slug === 'problem') {
      let current = await detail(task.id)
      if (current.delivery_state !== 'FAILED' || current.business_status !== 'PENDING' || Number(current.attempts) < 5) {
        if (current.business_status !== 'PENDING' || current.delivery_state === 'REVIEW' || current.delivery_state === 'FAILED') {
          throw new Error(`${title}: unsafe existing state ${current.delivery_state}/${current.business_status}; seed will not alter it`)
        }
        await request(emulator, `/operations/${task.id}`, { expected: 404 })
        current = await until(title, () => detail(task.id), (state) => state.delivery_state === 'FAILED' && state.business_status === 'PENDING' && Number(state.attempts) >= 5, 90000)
      }
      await request(emulator, `/operations/${task.id}`, { expected: 404 })
      let found = false
      for (let page = 0; page < 10000; page++) {
        const problems = await request(api, `/api/operator/tasks/problems?page=${page}`, { user: 'operator' })
        if (problems.items.some((item) => item.id === task.id)) { found = true; break }
        if (!problems.hasNext) break
      }
      if (!found) throw new Error('Демо-проблема отсутствует в операторском списке')
    } else {
      let state = await detail(task.id)
      if (slug === 'offline' || slug === 'lost' || slug === 'duplicate' || slug === 'delayed') {
        if (state.delivery_state === 'REVIEW' || state.delivery_state === 'FAILED') {
          throw new Error(`${title}: expected successful delivery, found ${state.delivery_state}/${state.business_status}; seed will not overwrite it`)
        }
        // Fault configuration was committed before the idempotent POST, so the worker can
        // only observe it after this scenario's task becomes eligible for delivery.
        if (slug === 'offline' || slug === 'lost') {
          await until(title, () => detail(task.id), (value) => value.history.some((event) => event.event === 'AMBIGUOUS_RETRY'))
          if (slug === 'offline') await reset()
          if (slug === 'lost' && (await external(task.id)).executions !== 1) throw new Error('Потеря ответа: executions не равен 1')
        }
        if (slug === 'delayed' && state.delivery_state !== 'DONE') {
          await until(title, () => detail(task.id), (value) => value.delivery_state === 'READY' && value.business_status === 'PENDING' && value.lease_until && value.history.some((event) => event.event === 'ATTEMPT_1'), 12000)
        }
      }
      state = await until(title, () => detail(task.id), (value) => value.delivery_state === 'DONE' && value.business_status === 'SUCCEEDED')
      if ((await external(task.id)).executions !== 1) throw new Error(`${title}: executions не равен 1`)
      if (slug === 'duplicate' && state.history.filter((event) => event.event === 'RESULT_APPLY').length !== 1) throw new Error('Дубликат должен применить результат один раз')
      if (slug === 'regular') {
        if (process.env.DEMO_SEED_INTERRUPT_AFTER === 'regular-before-assignment') {
          throw new Error('Injected interruption after regular task delivery, before assignment audit')
        }
        const audited = await detail(task.id)
        const hasSeededAssignment = audited.assignmentHistory.some((entry) => entry.actor === 'operator' && entry.new_assignee === 'operator')
        if (!hasSeededAssignment && (audited.assignee !== null || Number(audited.local_version) !== 0)) {
          throw new Error(`${title}: assignment is missing but version/state changed; refusing to overwrite user changes`)
        }
        if (!hasSeededAssignment) {
          await request(api, `/api/tasks/${task.id}/assignee`, { user: 'operator', method: 'PATCH', body: { assignee: 'operator', version: audited.local_version } })
        }
        const verified = await detail(task.id)
        if (!verified.assignmentHistory.some((entry) => entry.actor === 'operator' && entry.new_assignee === 'operator')) throw new Error('Назначение не попало в аудит')
      }
    }
    console.log(`Seed task verified: ${owner} ${title} (${task.id})`)
    await reset()
  }
} finally {
  await reset()
}
