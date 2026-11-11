export function validateNf08Profile(report, maxBusinessRejectionRate = 0.01) {
  const failures = []
  const read = report?.combined?.reads
  const changes = report?.combined?.changes
  const measuredRequests = (read?.requests ?? 0) + (changes?.requests ?? 0)

  if (!Number.isFinite(maxBusinessRejectionRate) || maxBusinessRejectionRate < 0 || maxBusinessRejectionRate > 1) {
    throw new Error('Maximum business rejection rate must be in 0..1')
  }
  if (measuredRequests === 0 || !read?.requests || !changes?.requests || read.p95MsAllAttempts == null || changes.p95MsAllAttempts == null) {
    failures.push('empty_measurement_sample')
  }

  const operationNames = ['list', 'detail', 'create', 'patch']
  const operations = operationNames.map((name) => report?.operations?.[name] ?? null)
  for (const [index, operation] of operations.entries()) {
    const name = operationNames[index]
    if (!operation) {
      failures.push(`operation_group_missing:${name}`)
      continue
    }
    if (!Number.isInteger(operation.requests) || operation.requests < 1) failures.push(`operation_group_without_requests:${name}`)
    if (!Number.isInteger(operation.successful) || operation.successful < 1) failures.push(`operation_group_without_success:${name}`)
    if (!Number.isInteger(operation.errors) || operation.errors > 0) failures.push(`operation_group_errors:${name}`)
    const statusCodes = operation.statusCodes ?? {}
    if (Object.entries(statusCodes).some(([status, count]) => status !== '200' && count > 0)) {
      failures.push(`unexpected_http_status:${name}`)
    }
    if (operation.requests !== undefined && operation.successful !== undefined && operation.errors !== undefined &&
        operation.requests !== operation.successful + operation.errors) {
      failures.push(`operation_group_count_mismatch:${name}`)
    }
  }
  const rejected = operations.reduce((sum, operation) => sum + (operation?.businessRejections ?? 0), 0)
  const rejectionRate = measuredRequests ? rejected / measuredRequests : null
  if (rejectionRate !== null && rejectionRate > maxBusinessRejectionRate) failures.push('business_rejection_rate_exceeded')

  const externalSamples = report?.externalExecution?.latencyFromTaskCreatedToExecutorCommitMs?.samples ?? 0
  if (externalSamples === 0) failures.push('empty_external_execution_sample')

  const timingSamples = [
    report?.runtimeTimings?.worker?.claim?.samples,
    report?.runtimeTimings?.worker?.http?.samples,
    report?.runtimeTimings?.worker?.apply?.samples,
    report?.runtimeTimings?.emulator?.connection?.samples,
    report?.runtimeTimings?.emulator?.faultModeLock?.samples,
    report?.runtimeTimings?.emulator?.executorTransaction?.samples,
  ]
  if (timingSamples.some((count) => !Number.isInteger(count) || count < 1)) failures.push('empty_runtime_timing_sample')

  return {
    passed: failures.length === 0,
    failures,
    measuredRequests,
    businessRejections: rejected,
    businessRejectionRate: rejectionRate,
    maxBusinessRejectionRate,
    externalLatencySamples: externalSamples,
    runtimeTimingSamples: timingSamples,
  }
}
