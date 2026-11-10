import { readFileSync, statSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const dir of ['', 'backend', 'frontend']) {
  test(dir + ' instructions', () => {
    assert.match(readFileSync(join(root, dir, 'CLAUDE.md'), 'utf8'), /^@AGENTS\.md$/m)
    assert.ok(statSync(join(root, 'AGENTS.md')).size + (dir ? statSync(join(root, dir, 'AGENTS.md')).size : 0) < 32768)
  })
}


function missingRootScripts(text, scripts) {
  const matches = text.matchAll(/\bnpm\s+(?:--prefix\s+(?:\.\/?)\s+)?(?:run|run-script)\s+([\w][\w:.-]*)/g)
  return [...new Set([...matches].map((match) => match[1]).filter((name) => !Object.hasOwn(scripts, name)))]
}

test('detects missing root scripts without treating prefixed frontend scripts as root', () => {
  assert.deepEqual(missingRootScripts('npm run absent && npm --prefix . run-script missing && npm --prefix frontend run build && npm run check:agents', { 'check:agents': 'node check' }), ['absent', 'missing'])
})

test('working prompts reference existing root npm scripts', async () => {
  const { readdir } = await import('node:fs/promises')
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts
  const findings = []
  for (const entry of await readdir(join(root, 'prompts'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = join(entry.parentPath, entry.name)
    for (const name of missingRootScripts(readFileSync(file, 'utf8'), scripts)) findings.push(`${file}: npm run ${name}`)
  }
  assert.deepEqual(findings, [], `Unknown root npm scripts:\n${findings.join('\n')}`)
})
