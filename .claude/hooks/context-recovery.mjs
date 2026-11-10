import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const maxStatusLines = 30

/** Claude Code sets CLAUDE_PROJECT_DIR; Codex runs hooks in the session directory. */
function repositoryRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  return result.status === 0 ? result.stdout.trim() : null
}

const projectDir = resolve(
  process.env.CLAUDE_PROJECT_DIR ?? repositoryRoot() ?? process.cwd(),
)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 10_000,
    ...options,
  })
  return result.status === 0 ? result.stdout.trim() : null
}

/**
 * The pinned dev dependency first; otherwise a `backlog` on PATH (npm -g, bun, brew), as in
 * projects that keep Backlog.md outside their own package.json. npm shims on Windows are
 * .cmd files, which Node runs only through a shell.
 */
function listBacklogTasks(status) {
  const args = ['task', 'list', '-s', status, '--plain']
  const localCli = join(projectDir, 'node_modules', 'backlog.md', 'cli.js')
  if (existsSync(localCli)) return run(process.execPath, [localCli, ...args])
  if (process.platform !== 'win32') return run('backlog', args)
  const commandLine = ['backlog', ...args.map((arg) => `"${arg}"`)].join(' ')
  return run(commandLine, [], { shell: true })
}

function readWorklogTaskLine() {
  try {
    const worklog = readFileSync(join(projectDir, 'WORKLOG.md'), 'utf8')
    return worklog.split(/\r?\n/).find((line) => line.startsWith('Task:')) ?? null
  } catch {
    return null
  }
}

const inProgress = listBacklogTasks('In Progress')
const worklogTask = readWorklogTaskLine()
const gitStatus = run('git', ['status', '--short', '--branch'])

let inProgressText
if (inProgress === null) {
  inProgressText =
    '(Backlog.md недоступен: установите зависимости проекта или backlog в PATH и проверьте вручную)'
} else if (inProgress === '') {
  inProgressText = '(нет задач в In Progress)'
} else {
  inProgressText = inProgress
}

const lines = [
  'Восстановление контекста: прежде чем продолжать, выполните протокол из раздела «Восстановление контекста» AGENTS.md.',
  'Прочитайте PROJECT_OVERVIEW.md, PROGRESS.md, активную задачу (npm run backlog -- task view <id> --plain), WORKLOG.md, затем git diff.',
  '',
  'Задачи в In Progress:',
  inProgressText,
  '',
  `WORKLOG.md: ${worklogTask ?? '(файла нет или нет строки Task)'}`,
]

if (gitStatus !== null) {
  const statusLines = gitStatus.split(/\r?\n/)
  lines.push('', 'git status:', ...statusLines.slice(0, maxStatusLines))
  if (statusLines.length > maxStatusLines) {
    lines.push(`... ещё ${statusLines.length - maxStatusLines}`)
  }
}

console.log(lines.join('\n'))
