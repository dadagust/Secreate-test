import { spawnSync } from 'node:child_process'

// Runs a Serena Claude Code hook when Serena is installed and exits silently otherwise,
// so the shared project settings work for contributors who have not installed Serena.
const allowedCommands = new Set(['activate', 'remind', 'cleanup'])
const [command] = process.argv.slice(2)

if (!allowedCommands.has(command)) {
  console.error(`Unsupported Serena hook command: ${command}`)
  process.exit(1)
}

const result = spawnSync('serena-hooks', [command, '--client=claude-code'], {
  stdio: 'inherit',
})

if (result.error) {
  process.exit(result.error.code === 'ENOENT' ? 0 : 1)
}

process.exit(result.status ?? 1)
