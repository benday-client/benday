// proves the staged-snapshot runner with real repositories: the fixture's own
// `check` script imports a module, so a missing index entry is a real failed
// import rather than a stubbed echo of the runner's arguments.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const RUNNER = fileURLToPath(new URL('./check-staged.mjs', import.meta.url))
const LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .: {}
`
const PACKAGE = `${JSON.stringify(
  { name: 'staged-fixture', private: true, scripts: { check: 'node check.mjs' } },
  null,
  2,
)}\n`

// pnpm sits beside the node binary that runs this suite; the pre-commit
// environment and a normal install both keep them in one bin directory.
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` }

const roots = []
const repos = []

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function snapshot(cwd) {
  return [
    git(cwd, 'status', '--porcelain=v1', '-z'),
    git(cwd, 'diff', '--cached', '--raw', '-z'),
    git(cwd, 'ls-files', '-v', '-z'),
  ].join('\u0000snapshot\u0000')
}

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'benday-staged-fixture-'))
  roots.push(root)
  await writeFile(join(root, 'package.json'), PACKAGE)
  await writeFile(join(root, 'pnpm-lock.yaml'), LOCKFILE)
  await writeFile(join(root, 'check.mjs'), "import './dep.mjs'\nconsole.log('checked')\n")
  await writeFile(join(root, 'dep.mjs'), 'export const present = true\n')
  git(root, 'init', '--quiet')
  repos.push(root)
  return root
}

/** Stage the fixture's always-present files, then whatever the case adds. */
function stage(root, ...paths) {
  git(root, 'add', '--', 'package.json', 'pnpm-lock.yaml', 'check.mjs', ...paths)
}

function runChecker(cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER], { cwd, env })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr })
    })
  })
}

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

test('refuses a dependency that is not in the index', async () => {
  const root = await makeRepo()
  stage(root)

  const result = await runChecker(root)
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /Cannot find module/)
})

test('checks a fully staged dependency', async () => {
  const root = await makeRepo()
  stage(root, 'dep.mjs')

  const result = await runChecker(root)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /checked/)
})

test('exports a staged skip-worktree dependency', async () => {
  const root = await makeRepo()
  stage(root, 'dep.mjs')
  git(root, 'update-index', '--skip-worktree', 'dep.mjs')

  const result = await runChecker(root)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /checked/)
})

test('rejects intent-to-add entries before installing', async () => {
  const root = await makeRepo()
  stage(root, 'dep.mjs')
  await writeFile(join(root, 'later.mjs'), 'export const later = true\n')
  git(root, 'add', '--intent-to-add', '--', 'later.mjs')

  const result = await runChecker(root)
  assert.equal(result.code, 1)
  assert.match(result.stderr, /stage or remove intent-to-add entries before checking/)
})

test('checks the staged copy even when the worktree copy is valid', async () => {
  const root = await makeRepo()
  await writeFile(join(root, 'dep.mjs'), 'export const present = (\n')
  stage(root, 'dep.mjs')
  // the worktree now holds a valid file; only the broken indexed copy may run
  await writeFile(join(root, 'dep.mjs'), 'export const present = true\n')

  const result = await runChecker(root)
  assert.notEqual(result.code, 0)
})

test('leaves the original index and worktree alone', async () => {
  const root = await makeRepo()
  stage(root, 'dep.mjs')
  // a dirty tracked file and an untracked one must neither join the check nor
  // change while it runs
  await writeFile(join(root, 'dep.mjs'), 'export const present = false\n')
  await writeFile(join(root, 'scratch.txt'), 'local only\n')
  const before = snapshot(root)

  const result = await runChecker(root)
  assert.equal(result.code, 0, result.stderr)

  assert.equal(snapshot(root), before)
})
