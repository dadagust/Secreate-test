const taskStatuses = new Set(['PENDING', 'SUCCEEDED', 'FAILED'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validateNf08ApiResponse(operation, statusCode, body, expected = {}) {
  if (statusCode !== 200) return { valid: false, reason: `unexpected_http_status_${statusCode}` }

  let response
  try {
    response = typeof body === 'string' ? JSON.parse(body) : body
  } catch {
    return { valid: false, reason: 'invalid_json_response' }
  }

  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { valid: false, reason: 'invalid_json_response' }
  }

  if (operation === 'list') {
    const items = response.items
    const valid = Array.isArray(items) && items.length === 20 && response.page === expected.page &&
      typeof response.hasNext === 'boolean' && items.every((item) => item?.business_status === expected.status)
    return valid ? { valid: true } : { valid: false, reason: 'invalid_filtered_list_response' }
  }
  if (operation === 'detail') {
    const valid = response.id === expected.id && taskStatuses.has(response.status)
    return valid ? { valid: true } : { valid: false, reason: 'invalid_task_detail_response' }
  }
  if (operation === 'create') {
    const valid = response.title === expected.title && response.status === 'PENDING' && uuid.test(response.id ?? '')
    return valid ? { valid: true } : { valid: false, reason: 'invalid_task_created_response' }
  }
  if (operation === 'patch') {
    const valid = response.id === expected.id && response.assignee === expected.assignee && Number(response.version) === expected.version
    return valid ? { valid: true } : { valid: false, reason: 'invalid_assignee_patch_response' }
  }

  return { valid: false, reason: 'unknown_operation' }
}
