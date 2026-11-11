export type WorkspaceRoute = {
  selected: string | null
  problems: boolean
  page: number
  status: string
}

type LocationParts = Pick<Location, 'pathname' | 'search'>

function routeQuery(search: string): Pick<WorkspaceRoute, 'page' | 'status'> {
  const query = new URLSearchParams(search)
  const pageValue = Number(query.get('page') ?? 0)
  return {
    page: Number.isSafeInteger(pageValue) && pageValue >= 0 ? pageValue : 0,
    status: query.get('status') ?? '',
  }
}

export function parseWorkspaceRoute(location: LocationParts): WorkspaceRoute {
  const query = routeQuery(location.search)
  const path = location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/tasks/problems') return { ...query, selected: null, problems: true }
  if (path === '/tasks' || path === '/') return { ...query, selected: null, problems: false }

  const match = path.match(/^\/tasks\/([^/]+)$/)
  if (match) {
    try {
      const selected = decodeURIComponent(match[1])
      if (selected) return { ...query, selected, problems: false }
    } catch { /* Malformed percent-encoding falls back to the registry. */ }
  }
  return { ...query, selected: null, problems: false }
}

export function workspaceRoutePath(route: WorkspaceRoute): string {
  const path = route.selected
    ? `/tasks/${encodeURIComponent(route.selected)}`
    : route.problems ? '/tasks/problems' : '/tasks'
  const query = new URLSearchParams()
  if (route.status) query.set('status', route.status)
  if (route.page > 0) query.set('page', String(route.page))
  const search = query.toString()
  return search ? `${path}?${search}` : path
}

export function writeWorkspaceRoute(route: WorkspaceRoute, replace = false): void {
  const path = workspaceRoutePath(route)
  if (`${window.location.pathname}${window.location.search}` === path) return
  if (replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
}
