const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const ui = process.env.TASK004_UI_BASE || 'http://127.0.0.1:5173'
const api = process.env.TASK004_API_BASE || ui
const emulator = process.env.TASK004_EMULATOR_BASE || 'http://127.0.0.1:9090'
const browserPath = process.env.TASK3_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const authorization = 'Basic ' + Buffer.from('alice:demo-alice').toString('base64')

async function setMode(page, method, path) {
  const response = await page.request.fetch(`${emulator}${path}`, { method })
  assert.equal(response.status(), 204, `mode change ${path} returned ${response.status()}`)
}

async function operatorTask(page, id) {
  const response = await page.request.get(`${api}/api/operator/tasks/${id}`, { headers: { Authorization: 'Basic ' + Buffer.from('operator:demo-operator').toString('base64') } })
  assert.equal(response.status(), 200)
  return response.json()
}

async function externalOperation(page, id) {
  const response = await page.request.get(`${emulator}/operations/${id}`)
  assert.equal(response.status(), 200)
  return response.json()
}

async function waitFor(predicate, message, timeoutMs = 9000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const value = await predicate()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 75))
  }
  throw new Error(message)
}

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: browserPath })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  try {
    await setMode(page, 'DELETE', '/fault-modes')
    await setMode(page, 'PUT', '/fault-modes/delayed-result?delayMs=2400')
    const title = `TASK-004 delayed ${crypto.randomUUID()}`
    const createdResponse = await page.request.post(`${api}/api/tasks`, {
      headers: { Authorization: authorization, 'Idempotency-Key': crypto.randomUUID() },
      data: { title },
    })
    assert.equal(createdResponse.status(), 200)
    const id = (await createdResponse.json()).id

    await page.goto(ui)
    await page.getByLabel('Пользователь').selectOption('operator')
    await page.getByLabel('Пароль').fill('demo-operator')
    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByRole('heading', { name: 'Рабочая консоль' }).waitFor()
    const row = page.getByRole('button', { name: title })
    await row.waitFor()
    await row.click()
    await page.getByRole('heading', { name: title }).waitFor()

    const active = await waitFor(async () => {
      const state = await operatorTask(page, id)
      const leaseActive = state.lease_until && Date.parse(state.lease_until) > Date.now()
      return state.delivery_state === 'READY' && state.business_status === 'PENDING' && leaseActive ? state : null
    }, 'the delayed emulator call did not expose its active delivery lease')
    assert.equal(active.history.some(event => event.event === 'ATTEMPT_1'), true)
    await page.getByRole('button', { name: 'Обновить', exact: true }).click()
    const facts = await page.locator('.facts').innerText()
    assert.match(facts, /Доставка\s*Ожидает доставки/)
    assert.match(facts, /Исполнение\s*Ожидает/)

    await waitFor(async () => {
      const remote = await externalOperation(page, id)
      return remote.executions === 1 ? remote : null
    }, 'the emulator did not save exactly one execution')
    await waitFor(async () => {
      const state = await operatorTask(page, id)
      return state.delivery_state === 'DONE' && state.business_status === 'SUCCEEDED' ? state : null
    }, 'the delayed result did not reach the application')
    await page.getByRole('button', { name: 'Обновить', exact: true }).click()
    await page.getByText('Выполнено', { exact: true }).waitFor()
    const remote = await externalOperation(page, id)
    assert.equal(remote.operationId, id)
    assert.equal(remote.executions, 1)

    await setMode(page, 'PUT', '/fault-modes/unavailable')
    const problemTitle = `TASK-004 operator problem ${crypto.randomUUID()}`
    const problemCreate = await page.request.post(`${api}/api/tasks`, {
      headers: { Authorization: authorization, 'Idempotency-Key': crypto.randomUUID() },
      data: { title: problemTitle },
    })
    assert.equal(problemCreate.status(), 200)
    const problemId = (await problemCreate.json()).id
    const issue = await waitFor(async () => {
      const state = await operatorTask(page, problemId)
      return state.history.some(event => event.event === 'AMBIGUOUS_RETRY') ? state : null
    }, 'the unavailable operation did not become an operator problem')
    assert.equal(issue.business_status, 'PENDING')
    const listed = await page.request.get(`${api}/api/operator/tasks/problems?page=0`, { headers: { Authorization: 'Basic ' + Buffer.from('operator:demo-operator').toString('base64') } })
    assert.equal(listed.status(), 200)
    assert.ok((await listed.json()).items.some(item => item.id === problemId))
    const externalMissing = await page.request.get(`${emulator}/operations/${problemId}`)
    assert.equal(externalMissing.status(), 404)
    await page.getByRole('button', { name: 'К реестру' }).click()
    await page.getByRole('button', { name: 'Проблемы', exact: true }).click()
    const problemRow = page.getByRole('button', { name: problemTitle })
    await problemRow.waitFor()
    await problemRow.click()
    await page.getByRole('heading', { name: problemTitle }).waitFor()
    const problemCard = await page.locator('.detail').innerText()
    assert.match(problemCard, /Доставка\s*Ожидает доставки/)
    assert.match(problemCard, /Исполнение\s*Ожидает/)
    assert.match(problemCard, /Ответ не получен, запланирован повтор/)
    console.log('TASK-004 browser: delayed READY/PENDING, one external execution, and operator opened the unavailable task from Problems')
  } finally {
    await setMode(page, 'DELETE', '/fault-modes').catch(() => {})
    await context.close()
    await browser.close()
  }
}

run().catch(error => { console.error(error); process.exitCode = 1 })
