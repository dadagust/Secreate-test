function describeBody(body) {
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed === 'string') return parsed.trim()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const key of ['detail', 'message', 'title', 'error']) {
        const value = parsed[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
        if (value && typeof value === 'object') return JSON.stringify(value)
      }
    }
  } catch {
    // Non-JSON error bodies are retained as a short diagnostic reason below.
  }
  return String(body ?? '').trim()
}

export function classifyNf08HttpFailure(status, body, elapsedMs) {
  const numericStatus = Number(status)
  const description = describeBody(body).slice(0, 120)
  const isBusinessRejection = numericStatus >= 400 && numericStatus < 500
  return {
    elapsedMs,
    ok: false,
    status: numericStatus,
    reason: `http_${numericStatus}${description ? `:${description}` : ''}`,
    timeout: false,
    businessRejected: isBusinessRejection,
    businessReason: isBusinessRejection ? `http_${numericStatus}` : undefined,
  }
}
