// the assertion gate is itself a parser: prove the shapes it must catch, the
// shapes it must leave alone, and that the cli fails both a violation and a file
// it cannot parse.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { findDoubleAssertions } from './check-assertions.mjs'

const CLI = fileURLToPath(new URL('./check-assertions.mjs', import.meta.url))
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` }

const roots = []

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

async function tempFile(name, source) {
  const root = await mkdtemp(join(tmpdir(), 'benday-assertions-'))
  roots.push(root)
  const file = join(root, name)
  await writeFile(file, source)
  return file
}

function runCli(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env })
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
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

test('reports an erased double assertion through both syntaxes', () => {
  const cases = [
    'const value = input as unknown as Target\n',
    'const value = (<unknown>input) as Target\n',
    'const value = input as any as Target\n',
    'const value = input as never as Target\n',
  ]
  for (const source of cases) {
    assert.equal(findDoubleAssertions(source, 'case.ts').length, 1, source)
  }
})

test('sees through parentheses, non-null and satisfies wrappers', () => {
  const cases = [
    'const value = ((input as unknown)) as Target\n',
    'const value = ((((input as unknown)))) as Target\n',
    'const value = (input as unknown)! as Target\n',
    'const value = (input as unknown) satisfies object as Target\n',
  ]
  for (const source of cases) {
    assert.equal(findDoubleAssertions(source, 'case.ts').length, 1, source)
  }
})

test('sees through comments, newlines, parenthesized types and tsx', () => {
  const cases = [
    'const value = input as unknown /* erased */ as Target\n',
    'const value = input as\n  unknown as Target\n',
    'const value = input as (unknown) as Target\n',
  ]
  for (const source of cases) {
    assert.equal(findDoubleAssertions(source, 'case.ts').length, 1, source)
  }
  const tsx = 'export const View = () => <div>{input as unknown as Target}</div>\n'
  assert.equal(findDoubleAssertions(tsx, 'case.tsx').length, 1)
})

test('reports one entry per outer assertion, at its position', () => {
  const source = 'const first = a as unknown as A\nconst second = b as any as B\n'
  const found = findDoubleAssertions(source, 'case.ts')
  assert.deepEqual(found, [
    { line: 1, column: 15 },
    { line: 2, column: 16 },
  ])
})

test('leaves a single assertion, as const and unrelated nesting alone', () => {
  const source = [
    'const one = input as Target',
    'const two = input as unknown',
    'const three = { field: 1 } as const',
    'const four = ({ field: input as unknown }) as Target',
    'const five = wrapper({ inner: input as number }) as Target',
    '',
  ].join('\n')
  assert.deepEqual(findDoubleAssertions(source, 'case.ts'), [])
})

test('does not read comments or strings as assertions', () => {
  const source = [
    '// input as unknown as Target is the shape this gate rejects',
    "const message = 'input as unknown as Target'",
    'const template = `input as unknown as Target`',
    '',
  ].join('\n')
  assert.deepEqual(findDoubleAssertions(source, 'case.ts'), [])
})

test('rejects malformed syntax instead of guessing', () => {
  assert.throws(() => findDoubleAssertions('const value = input as unknown as\n', 'case.ts'))
})

test('the cli fails a violating file and names the position', async () => {
  const file = await tempFile('bad.ts', 'const value = input as unknown as Target\n')
  const result = await runCli(process.cwd(), [file])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /bad\.ts:1:15: double assertion through an erased type/)
})

test('the cli fails a file it cannot parse', async () => {
  const file = await tempFile('broken.ts', 'const value = input as unknown as\n')
  const result = await runCli(process.cwd(), [file])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /could not be parsed/)
})

test('the cli passes a clean file', async () => {
  const file = await tempFile('clean.ts', 'const value: Target = input as Target\n')
  const result = await runCli(process.cwd(), [file])
  assert.equal(result.code, 0, result.stderr)
})

test('with no arguments the cli scans the tracked and untracked repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'benday-assertions-repo-'))
  roots.push(root)
  await writeFile(join(root, 'clean.ts'), 'export const value = 1\n')
  execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['add', '--', 'clean.ts'], { cwd: root, stdio: 'ignore' })

  const clean = await runCli(root, [])
  assert.equal(clean.code, 0, clean.stderr)

  // an untracked source file is still a file that could be committed
  await writeFile(join(root, 'dirty.ts'), 'export const value = input as unknown as Target\n')
  const dirty = await runCli(root, [])
  assert.equal(dirty.code, 1)
  assert.match(dirty.stderr, /dirty\.ts:1:22: double assertion through an erased type/)
})
