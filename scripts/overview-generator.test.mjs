import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('overview:check detects stale Markdown and HTML independently', () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const temp = mkdtempSync(join(tmpdir(), 'overview test '))
  try {
    mkdirSync(join(temp, 'scripts'), { recursive: true })
    mkdirSync(join(temp, 'docs', 'project'), { recursive: true })
    copyFileSync(join(root, 'scripts/generate-project-overview.mjs'), join(temp, 'scripts/generate-project-overview.mjs'))
    copyFileSync(join(root, 'docs/project/overview-source.txt'), join(temp, 'docs/project/overview-source.txt'))
    copyFileSync(join(root, 'README.md'), join(temp, 'README.md'))
    const run = (...args) => spawnSync(process.execPath, [join(temp, 'scripts/generate-project-overview.mjs'), ...args], { encoding: 'utf8' })
    assert.equal(run().status, 0)
    assert.equal(run('--check').status, 0)
    writeFileSync(join(temp, 'PROJECT_OVERVIEW.md'), 'stale markdown')
    assert.equal(run('--check').status, 1)
    assert.equal(run().status, 0)
    writeFileSync(join(temp, 'PROJECT_OVERVIEW.html'), 'stale html')
    assert.equal(run('--check').status, 1)
  } finally {
    if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected temporary directory')
    rmSync(temp, { recursive: true, force: true })
  }
})
