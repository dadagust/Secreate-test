import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { validateNf08Profile } from './nf08-profile-validation.mjs'
import { writeNf08Report } from './nf08-report.mjs'
import { validateNf08ApiResponse } from './nf08-response-validation.mjs'
import { classifyNf08HttpFailure } from './nf08-http-errors.mjs'
import { addNf08Metric, createNf08Metrics, summarizeNf08Metric } from './nf08-metrics.mjs'

const successfulOperation = {
  requests: 100, successful: 100, errors: 0, businessRejections: 0,
  statusCodes: { 200: 100 }, errorReasons: {},
}

function profile(overrides = {}) {
  return {
    operations: {
      list: { ...successfulOperation }, detail: { ...successfulOperation },
      create: { ...successfulOperation }, patch: { ...successfulOperation },
    },
    combined: {
      reads: { requests: 200, p95MsAllAttempts: 100 },
      changes: { requests: 200, p95MsAllAttempts: 110 },
    },
    externalExecution: { latencyFromTaskCreatedToExecutorCommitMs: { samples: 50 } },
    runtimeTimings: {
      worker: { claim: { samples: 50 }, http: { samples: 50 }, apply: { samples: 50 } },
      emulator: { connection: { samples: 50 }, faultModeLock: { samples: 50 }, executorTransaction: { samples: 50 } },
    },
    ...overrides,
  }
}

test('accepts a non-empty NF08 profile within business rejection limit', () => {
  assert.equal(validateNf08Profile(profile()).passed, true)
})

test('rejects an empty page as an invalid list response', () => {
  assert.deepEqual(validateNf08ApiResponse('list', 200, JSON.stringify({ items: [], page: 0, hasNext: false }), { status: 'SUCCEEDED' }), {
    valid: false, reason: 'invalid_filtered_list_response',
  })
})

test('an empty list page makes the whole profile invalid and preserves the failed report', async () => {
  const response = validateNf08ApiResponse('list', 200, JSON.stringify({ items: [], page: 0, hasNext: false }), { status: 'SUCCEEDED', page: 0 })
  assert.equal(response.valid, false)

  const report = profile({
    operations: {
      list: { requests: 1, successful: 0, errors: 1, businessRejections: 0, statusCodes: { 200: 1 }, errorReasons: { [response.reason]: 1 }, contractErrors: 1 },
      detail: { ...successfulOperation },
      create: { ...successfulOperation },
      patch: { ...successfulOperation },
    },
    combined: { reads: { requests: 101, p95MsAllAttempts: 100 }, changes: { requests: 200, p95MsAllAttempts: 110 } },
  })

  const directory = await mkdtemp(path.join(os.tmpdir(), 'nf08-empty-page-'))
  try {
    const output = path.join(directory, 'profile.json')
    const validity = await writeNf08Report(output, report)
    assert.equal(validity.passed, false)
    assert.ok(validity.failures.includes('operation_group_without_success:list'))
    assert.ok(validity.failures.includes('operation_group_errors:list'))
    const saved = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(saved.validity.passed, false)
    assert.ok(saved.validity.failures.includes('operation_group_errors:list'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects a list response with fewer than twenty records', () => {
  const body = JSON.stringify({ items: Array.from({ length: 19 }, () => ({ business_status: 'SUCCEEDED' })), page: 0, hasNext: false })
  assert.equal(validateNf08ApiResponse('list', 200, body, { status: 'SUCCEEDED' }).valid, false)
})

test('requires successful requests in each operation group and rejects fast 5xx-only groups', () => {
  const report = profile({
    operations: {
      list: { ...successfulOperation },
      detail: { ...successfulOperation },
      create: { ...successfulOperation },
      patch: { requests: 100, successful: 0, errors: 100, businessRejections: 0, statusCodes: { 503: 100 }, errorReasons: { http_503: 100 } },
    },
  })
  const result = validateNf08Profile(report)
  assert.equal(result.passed, false)
  assert.ok(result.failures.includes('operation_group_without_success:patch'))
  assert.ok(result.failures.includes('operation_group_errors:patch'))
  assert.ok(result.failures.includes('unexpected_http_status:patch'))
})

test('409 and 503 failures retain their HTTP status and reason in invalid profile JSON', async () => {
  const cases = [
    { status: 409, body: JSON.stringify({ message: 'Data changed. Refresh the task.' }), businessRejected: true },
    { status: 503, body: JSON.stringify({ message: 'Database unavailable.' }), businessRejected: false },
  ]
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nf08-http-failures-'))
  try {
    for (const { status, body, businessRejected } of cases) {
      const sample = classifyNf08HttpFailure(status, body, 12.5)
      assert.equal(sample.ok, false)
      assert.equal(sample.status, status)
      assert.match(sample.reason, new RegExp(`^http_${status}:`))
      assert.ok(sample.reason.includes(JSON.parse(body).message))
      assert.equal(sample.businessRejected, businessRejected)

      const metric = createNf08Metrics()
      addNf08Metric(metric, sample)
      const report = profile()
      report.operations.patch = summarizeNf08Metric(metric)
      report.combined.changes = { requests: 101, p95MsAllAttempts: 12.5 }

      const output = path.join(directory, `http-${status}.json`)
      const validity = await writeNf08Report(output, report)
      assert.equal(validity.passed, false)
      const saved = JSON.parse(await readFile(output, 'utf8'))
      assert.equal(saved.validity.passed, false)
      assert.equal(saved.operations.patch.statusCodes[String(status)], 1)
      assert.equal(saved.operations.patch.errorReasons[sample.reason], 1)
      assert.equal(saved.operations.patch.businessRejections, businessRejected ? 1 : 0)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects empty request and external latency samples', () => {
  const result = validateNf08Profile(profile({
    combined: { reads: { requests: 0, p95MsAllAttempts: null }, changes: { requests: 0, p95MsAllAttempts: null } },
    externalExecution: { latencyFromTaskCreatedToExecutorCommitMs: { samples: 0 } },
  }))
  assert.ok(result.failures.includes('empty_measurement_sample'))
  assert.ok(result.failures.includes('empty_external_execution_sample'))
})

test('rejects a run where valid business requests are mostly rejected', () => {
  const result = validateNf08Profile(profile({
    operations: {
      list: { ...successfulOperation }, detail: { ...successfulOperation },
      create: { ...successfulOperation, businessRejections: 10 }, patch: { ...successfulOperation },
    },
  }), 0.01)
  assert.ok(result.failures.includes('business_rejection_rate_exceeded'))
  assert.equal(result.businessRejectionRate, 0.025)
})

test('requires non-empty worker and emulator phase timing samples', () => {
  const report = profile()
  report.runtimeTimings.emulator.faultModeLock.samples = 0
  const result = validateNf08Profile(report)
  assert.equal(result.passed, false)
  assert.ok(result.failures.includes('empty_runtime_timing_sample'))
})

test('preserves JSON before failing empty and rejected profiles', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nf08-report-'))
  try {
    const emptyFile = path.join(directory, 'empty.json')
    const empty = profile({
      combined: { reads: { requests: 0, p95MsAllAttempts: null }, changes: { requests: 0, p95MsAllAttempts: null } },
      externalExecution: { latencyFromTaskCreatedToExecutorCommitMs: { samples: 0 } },
    })
    const emptyValidity = await writeNf08Report(emptyFile, empty)
    assert.equal(emptyValidity.passed, false)
    const emptyFailures = JSON.parse(await readFile(emptyFile, 'utf8')).validity.failures
    assert.ok(emptyFailures.includes('empty_measurement_sample'))
    assert.ok(emptyFailures.includes('empty_external_execution_sample'))

    const rejectedFile = path.join(directory, 'rejected.json')
    const rejected = profile({
    operations: { list: { ...successfulOperation }, detail: { ...successfulOperation }, create: { ...successfulOperation, businessRejections: 100 }, patch: { ...successfulOperation } },
    })
    const rejectedValidity = await writeNf08Report(rejectedFile, rejected)
    assert.equal(rejectedValidity.passed, false)
    assert.ok(JSON.parse(await readFile(rejectedFile, 'utf8')).validity.failures.includes('business_rejection_rate_exceeded'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
