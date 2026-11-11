import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyExecutionCounts, parseExecutionSnapshot } from './nf08-counts.mjs'

test('counts the overlap between external execution and unfinished local delivery', () => {
  assert.deepEqual(classifyExecutionCounts(811, 372, 440), {
    accepted: 811, externallyExecuted: 372, unfinished: 440,
    externallyNotExecuted: 439, executedButLocallyUnfinished: 1,
  })
  assert.deepEqual(classifyExecutionCounts(853, 0, 853), {
    accepted: 853, externallyExecuted: 0, unfinished: 853,
    externallyNotExecuted: 853, executedButLocallyUnfinished: 0,
  })
})

test('rejects impossible snapshots', () => {
  for (const values of [[3, 4, 0], [3, 1, 1], [3, 1, 4], [3, 1.5, 2]]) {
    assert.throws(() => classifyExecutionCounts(...values), /Inconsistent/)
  }
})

test('requires one latency sample for each execution in the same snapshot', () => {
  const snapshot = parseExecutionSnapshot({ accepted: 3, externallyExecuted: 2, unfinished: 2, externalLatencyMs: [120.5, 130] })
  assert.equal(snapshot.executedButLocallyUnfinished, 1)
  assert.deepEqual(snapshot.externalLatencyMs, [120.5, 130])
  assert.throws(() => parseExecutionSnapshot({ accepted: 3, externallyExecuted: 2, unfinished: 2, externalLatencyMs: [120, 130, 140] }), /do not match/)
})
