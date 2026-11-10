import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const hooksDir = dirname(fileURLToPath(import.meta.url))
const root = join(hooksDir, '..', '..')
const codex = JSON.parse(readFileSync(join(root, '.codex', 'hooks.json'), 'utf8')).hooks
const claude = JSON.parse(
  readFileSync(join(root, '.claude', 'settings.json'), 'utf8'),
).hooks

// Git exports GIT_DIR and friends to hooks; inherited by `git rev-parse` in the hook command,
// they would point it at the repository of the commit being made instead of this checkout.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key]
}

function scripts(groups) {
  return groups
    .flatMap((group) => group.hooks)
    .flatMap((handler) => [handler.command, ...(handler.args ?? [])])
    .flatMap((text) => text.match(/\.claude\/hooks\/[\w-]+\.mjs/g) ?? [])
    .sort()
}

/**
 * Runs a handler in the shell Codex uses for the session (PowerShell on Windows, a POSIX
 * shell elsewhere) from the given directory.
 */
function runHandler(handler, cwd, input) {
  const options = { cwd, input: JSON.stringify(input), encoding: 'utf8' }
  return process.platform === 'win32'
    ? spawnSync(
        'powershell.exe',
        ['-NoProfile', '-Command', handler.commandWindows],
        options,
      )
    : spawnSync('sh', ['-c', handler.command], options)
}

const guardGroups = codex.PreToolUse.filter((group) =>
  new RegExp(group.matcher).test('Bash'),
)
const recoveryGroups = codex.SessionStart.filter((group) =>
  new RegExp(group.matcher).test('compact'),
)
const [guard] = guardGroups[0].hooks
const [recovery] = recoveryGroups[0].hooks

// A copy of the hooks in a repository whose path has a space and non-ASCII letters, which
// Windows PowerShell 5.1 garbles in the output of native commands.
const repo = mkdtempSync(join(tmpdir(), 'codex hooks проект '))
mkdirSync(join(repo, '.claude', 'hooks'), { recursive: true })
for (const script of ['guard-commands.mjs', 'context-recovery.mjs']) {
  copyFileSync(join(hooksDir, script), join(repo, '.claude', 'hooks', script))
}
if (spawnSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' }).status !== 0) {
  throw new Error(`git init failed in ${repo}`)
}
const subdirectory = join(repo, 'packages', 'app')
mkdirSync(subdirectory, { recursive: true })
after(() => rmSync(repo, { recursive: true, force: true }))

describe('.codex/hooks.json', () => {
  it('runs the same scripts as .claude/settings.json', () => {
    assert.deepEqual(
      scripts(guardGroups),
      scripts(
        claude.PreToolUse.filter((group) => group.matcher.split('|').includes('Bash')),
      ),
    )
    assert.deepEqual(
      scripts(recoveryGroups),
      scripts(claude.SessionStart.filter((group) => group.matcher === 'compact')),
    )
  })

  it('recovers context after compaction and on resume, not on a fresh start', () => {
    const matchers = codex.SessionStart.map((group) => new RegExp(group.matcher))
    assert.ok(matchers.some((matcher) => matcher.test('resume')))
    assert.ok(!matchers.some((matcher) => matcher.test('startup')))
  })

  it('runs the same command on Windows and keeps its exit code in PowerShell', () => {
    for (const group of [...codex.PreToolUse, ...codex.SessionStart]) {
      for (const handler of group.hooks) {
        assert.equal(handler.commandWindows, `${handler.command}; exit $LASTEXITCODE`)
      }
    }
  })

  for (const [place, cwd] of [
    ['a subdirectory of this checkout', hooksDir],
    ['a subdirectory of a repository with a non-ASCII path', subdirectory],
  ]) {
    it(`blocks a guarded command and allows others from ${place}`, () => {
      const blocked = runHandler(guard, cwd, {
        tool_name: 'Bash',
        tool_input: { command: 'git push' },
      })
      assert.equal(blocked.status, 2, blocked.stderr)
      assert.match(blocked.stderr, /git push needs an explicit request/)
      const allowed = runHandler(guard, cwd, {
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
      })
      assert.equal(allowed.status, 0, allowed.stderr)
    })

    it(`prints the recovery reminder from ${place}`, () => {
      const result = runHandler(recovery, cwd, {
        hook_event_name: 'SessionStart',
        source: 'compact',
      })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /^WORKLOG\.md: /m)
    })
  }
})
