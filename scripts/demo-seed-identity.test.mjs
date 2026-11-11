import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSeedTask, demoIdempotencyKey } from './demo-seed-identity.mjs'

function fakeSeedApi() {
  const records = new Map()
  let nextId = 1
  const events = []
  return {
    records,
    events,
    async setFaultMode(mode) { events.push(`mode:${mode ?? 'reset'}`) },
    async postTask(owner, key, title) {
      events.push(`post:${key}`)
      const mapKey = `${owner}:${key}`
      if (records.has(mapKey)) return records.get(mapKey)
      const task = { id: `seed-${nextId++}`, owner, key, title, assignee: null, assignmentAudit: [] }
      records.set(mapKey, task)
      return task
    },
  }
}

const create = (api, overrides = {}) => createSeedTask({
  owner: 'alice', slug: 'regular', title: 'Same visible title', fault: null,
  setFaultMode: api.setFaultMode, postTask: api.postTask, ...overrides,
})

test('clean seed creates one stable idempotent task and sets mode before publishing it', async () => {
  const api = fakeSeedApi()
  const task = await create(api, { fault: 'unavailable' })
  assert.equal(task.id, 'seed-1')
  assert.equal(api.records.size, 1)
  assert.deepEqual(api.events, ['mode:unavailable', `post:${demoIdempotencyKey('regular')}`])
})

test('repeat seed resolves to the same record without creating a duplicate', async () => {
  const api = fakeSeedApi()
  const first = await create(api)
  const second = await create(api)
  assert.equal(second.id, first.id)
  assert.equal(api.records.size, 1)
})

test('resume after interruption between creation and assignment preserves the task id', async () => {
  const api = fakeSeedApi()
  const first = await create(api)
  // Model a process stop after the idempotent POST committed but before the rest of seed work.
  const resumed = await create(api)
  const record = [...api.records.values()][0]
  record.assignee = 'operator'
  record.assignmentAudit.push({ actor: 'operator', assignee: 'operator' })
  assert.equal(resumed.id, first.id)
  assert.equal(api.records.size, 1)
  assert.equal(record.assignmentAudit.length, 1)
})

test('same owner and title do not make a user task seed-owned or mutable', async () => {
  const api = fakeSeedApi()
  const userTask = { id: 'user-1', owner: 'alice', key: 'user-key', title: 'Same visible title', assignee: 'bob', assignmentAudit: [{ actor: 'alice', assignee: 'bob' }] }
  api.records.set('alice:user-key', structuredClone(userTask))
  const seedTask = await create(api)
  const preservedUserTask = api.records.get('alice:user-key')
  assert.notEqual(seedTask.id, userTask.id)
  assert.deepEqual(preservedUserTask, userTask)
  assert.equal(api.records.size, 2)
})
