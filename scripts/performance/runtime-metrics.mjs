function percentile(values, proportion) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(proportion * sorted.length) - 1]
}

function summarize(values) {
  return {
    samples: values.length,
    p50Us: percentile(values, 0.5),
    p95Us: percentile(values, 0.95),
    meanUs: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
  }
}

function readValue(line, key) {
  const match = new RegExp(`(?:^|\\s)${key}=(\\d+)(?:\\s|$)`).exec(line)
  return match ? Number(match[1]) : null
}

export function summarizeRuntimeMetrics(logs) {
  const worker = { claim: [], http: [], apply: [] }
  const emulator = { connection: [], faultModeLock: [], executorTransaction: [] }

  for (const line of logs.split(/\r?\n/)) {
    if (line.includes('delivery_timing ')) {
      for (const [name, key] of [['claim', 'claim_us'], ['http', 'http_us'], ['apply', 'apply_us']]) {
        const value = readValue(line, key)
        if (value !== null) worker[name].push(value)
      }
    } else if (line.includes('emulator_timing ')) {
      for (const [name, key] of [
        ['connection', 'connection_us'],
        ['faultModeLock', 'fault_mode_lock_us'],
        ['executorTransaction', 'executor_transaction_us'],
      ]) {
        const value = readValue(line, key)
        if (value !== null) emulator[name].push(value)
      }
    }
  }

  return {
    worker: Object.fromEntries(Object.entries(worker).map(([name, values]) => [name, summarize(values)])),
    emulator: Object.fromEntries(Object.entries(emulator).map(([name, values]) => [name, summarize(values)])),
  }
}
