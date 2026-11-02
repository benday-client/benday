#!/usr/bin/env node
// verify the exact tree that is staged: not HEAD, not the working files. the
// index is exported into a throwaway repository, installed from the lockfile and
// gated there, so an unstaged dependency, a borrowed node_modules or a dirty
// worktree cannot make a broken commit look green.

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

class StagedCheckError extends Error {}

// reading the user's repository must not refresh its index; only exporting is
// allowed to touch it, and checkout-index only reads
const repoEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }

let activeChild = null
let interrupted = null

/** Clear inherited GIT_* variables so temporary-repository commands see themselves. */
function withoutGitEnv(env) {
  const clean = { ...env }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('GIT_')) delete clean[key]
  }
  return clean
}

function splitZ(output) {
  return output.split('\0').filter((entry) => entry.length > 0)
}

function signalCode(signal) {
  return signal === 'SIGINT' ? 130 : 143
}

function childFailure(command, args, code, signal) {
  const label = `${command} ${args.join(' ')}`
  return new Error(
    signal === null ? `${label} exited with ${code}` : `${label} was killed by ${signal}`,
  )
}

/** Run a command with inherited output and no shell interpolation. */
function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' })
    activeChild = child
    child.on('error', reject)
    child.on('close', (code, signal) => {
      activeChild = null
      if (interrupted !== null) {
        reject(new Error(`interrupted by ${interrupted}`))
        return
      }
      if (signal !== null || code !== 0) {
        reject(childFailure(command, args, code, signal))
        return
      }
      resolve()
    })
  })
}

/** Run a command and capture stdout, leaving stderr visible. */
function capture(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'inherit'] })
    activeChild = child
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      activeChild = null
      if (interrupted !== null) {
        reject(new Error(`interrupted by ${interrupted}`))
        return
      }
      if (signal !== null || code !== 0) {
        reject(childFailure(command, args, code, signal))
        return
      }
      resolve(stdout)
    })
  })
}

async function assertIndexIsCheckable(root) {
  const unmerged = await capture('git', ['ls-files', '--unmerged', '-z'], {
    cwd: root,
    env: repoEnv,
  })
  if (splitZ(unmerged).length > 0) {
    throw new StagedCheckError('resolve unmerged index entries before checking')
  }

  // an intent-to-add entry has no blob in the index; the two views of the cached
  // diff disagree exactly when one is present.
  const visible = await capture(
    'git',
    ['diff', '--cached', '--name-only', '-z', '--ita-visible-in-index'],
    { cwd: root, env: repoEnv },
  )
  const invisible = await capture(
    'git',
    ['diff', '--cached', '--name-only', '-z', '--ita-invisible-in-index'],
    { cwd: root, env: repoEnv },
  )
  const visiblePaths = new Set(splitZ(visible))
  const invisiblePaths = new Set(splitZ(invisible))
  if (
    visiblePaths.size !== invisiblePaths.size ||
    [...visiblePaths].some((path) => !invisiblePaths.has(path))
  ) {
    throw new StagedCheckError('stage or remove intent-to-add entries before checking')
  }
}

async function exportIndex(root, tree) {
  // trailing separator is required: git concatenates the prefix and the path
  await run(
    'git',
    ['checkout-index', '--all', '--ignore-skip-worktree-bits', `--prefix=${tree}${sep}`],
    { cwd: root, env: repoEnv },
  )
}

async function check() {
  const root = (
    await capture('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), env: repoEnv })
  ).trim()
  await assertIndexIsCheckable(root)

  const workspace = await mkdtemp(join(tmpdir(), 'benday-staged-'))
  try {
    // the tree needs a repository before biome and the source checker run, so it
    // gets its own history rather than a copy of the real one
    const tree = join(workspace, 'tree')
    await mkdir(tree)
    await exportIndex(root, tree)
    const env = withoutGitEnv(process.env)
    await run('git', ['init', '--quiet'], { cwd: tree, env })
    await run('git', ['add', '--force', '--all'], { cwd: tree, env })

    await run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: tree, env })
    await run('pnpm', ['check'], { cwd: tree, env })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

function forwardSignals() {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      interrupted = signal
      activeChild?.kill(signal)
    })
  }
}

try {
  forwardSignals()
  await check()
} catch (error) {
  if (error instanceof StagedCheckError) console.error(error.message)
  else console.error(`staged check failed: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}

if (interrupted !== null) process.exitCode = signalCode(interrupted)
