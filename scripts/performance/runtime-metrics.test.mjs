import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeRuntimeMetrics } from './runtime-metrics.mjs'

test('summarizes claim, HTTP, apply and emulator phases independently', () => {
  const metrics = summarizeRuntimeMetrics([
    'delivery_timing operationId=one attempt=1 outcome=RESULT_ACCEPTED claim_us=100 http_us=200 apply_us=300',
    'delivery_timing operationId=two attempt=1 outcome=RESULT_ACCEPTED claim_us=300 http_us=400 apply_us=500',
    'emulator_timing operationId=one outcome=RESULT_SENT connection_us=10 fault_mode_lock_us=20 executor_transaction_us=30',
  ].join('\n'))

  assert.deepEqual(metrics.worker.claim, { samples: 2, p50Us: 100, p95Us: 300, meanUs: 200 })
  assert.deepEqual(metrics.worker.http, { samples: 2, p50Us: 200, p95Us: 400, meanUs: 300 })
  assert.deepEqual(metrics.worker.apply, { samples: 2, p50Us: 300, p95Us: 500, meanUs: 400 })
  assert.deepEqual(metrics.emulator.faultModeLock, { samples: 1, p50Us: 20, p95Us: 20, meanUs: 20 })
})

test('reports empty phase samples instead of fabricating timings', () => {
  const metrics = summarizeRuntimeMetrics('')
  assert.deepEqual(metrics.worker.claim, { samples: 0, p50Us: null, p95Us: null, meanUs: null })
  assert.deepEqual(metrics.emulator.connection, { samples: 0, p50Us: null, p95Us: null, meanUs: null })
})
