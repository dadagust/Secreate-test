function percentile(values, percent) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(percent * sorted.length) - 1)]
}

export function createNf08Metrics() {
  return { samples: [], successfulSamples: [], success: 0, errors: 0, timeouts: 0, contractErrors: 0, businessRejections: 0, businessRejectionReasons: {}, errorReasons: {}, statusCodes: {} }
}

export function addNf08Metric(metric, sample) {
  metric.samples.push(sample.elapsedMs)
  if (sample.ok) {
    metric.success += 1
    metric.successfulSamples.push(sample.elapsedMs)
    metric.statusCodes[sample.status] = (metric.statusCodes[sample.status] ?? 0) + 1
  } else {
    metric.errors += 1
    if (sample.timeout) metric.timeouts += 1
    if (sample.contractError) metric.contractErrors += 1
    metric.errorReasons[sample.reason] = (metric.errorReasons[sample.reason] ?? 0) + 1
    if (sample.status) metric.statusCodes[sample.status] = (metric.statusCodes[sample.status] ?? 0) + 1
  }
  if (sample.businessRejected) {
    metric.businessRejections += 1
    const reason = sample.businessReason ?? 'unexpected_business_response'
    metric.businessRejectionReasons[reason] = (metric.businessRejectionReasons[reason] ?? 0) + 1
  }
}

export function summarizeNf08Metric(metric) {
  return {
    requests: metric.samples.length,
    successful: metric.success,
    errors: metric.errors,
    timeouts: metric.timeouts,
    contractErrors: metric.contractErrors,
    businessRejections: metric.businessRejections,
    businessRejectionReasons: metric.businessRejectionReasons,
    p50MsAllAttempts: percentile(metric.samples, 0.5),
    p95MsAllAttempts: percentile(metric.samples, 0.95),
    p95MsSuccessful: percentile(metric.successfulSamples, 0.95),
    p99MsAllAttempts: percentile(metric.samples, 0.99),
    meanMsAllAttempts: metric.samples.length ? metric.samples.reduce((sum, value) => sum + value, 0) / metric.samples.length : null,
    maxMsAllAttempts: metric.samples.length ? Math.max(...metric.samples) : null,
    statusCodes: metric.statusCodes,
    errorReasons: metric.errorReasons,
  }
}

export function summarizeNf08OperationBuckets(buckets) {
  return Object.fromEntries(Object.entries(buckets).map(([name, metric]) => [name, summarizeNf08Metric(metric)]))
}
