#!/usr/bin/env node
// a double assertion through an erased type is a hole in the type system: the
// first assertion erases the source type and the second claims a destination
// type nothing checked. find them in the ast, so comments, strings, parentheses
// and both assertion syntaxes cannot hide or fake one.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const ERASED_TYPES = new Set(['TSUnknownKeyword', 'TSNeverKeyword', 'TSAnyKeyword'])
const ASSERTION_NODES = new Set(['TSAsExpression', 'TSTypeAssertion'])
const OPERAND_WRAPPERS = new Set([
  'ParenthesizedExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
])
// metadata that does not hold child expressions
const SKIPPED_KEYS = new Set([
  'loc',
  'start',
  'end',
  'range',
  'extra',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'tokens',
  'errors',
])

function assertionOperand(node) {
  let current = node
  while (current !== null && OPERAND_WRAPPERS.has(current.type)) current = current.expression
  return current
}

function isErasedType(typeNode) {
  let current = typeNode
  while (current !== null && current !== undefined && current.type === 'TSParenthesizedType') {
    current = current.typeAnnotation
  }
  return current !== null && current !== undefined && ERASED_TYPES.has(current.type)
}

function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (node === null || typeof node !== 'object') return
  if (typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (SKIPPED_KEYS.has(key)) continue
    walk(node[key], visit)
  }
}

/**
 * Report every outer assertion whose erased inner assertion hides the source
 * type. Returns `{ line, column }` entries in source order.
 */
export function findDoubleAssertions(source, filename = 'input.ts') {
  const isTsx = filename.endsWith('.tsx')
  const ast = parse(source, {
    sourceType: 'module',
    plugins: isTsx ? ['typescript', 'jsx'] : ['typescript'],
    createParenthesizedExpressions: true,
    attachComment: false,
  })

  const found = []
  walk(ast.program, (node) => {
    if (!ASSERTION_NODES.has(node.type)) return
    const inner = assertionOperand(node.expression)
    if (inner === null || !ASSERTION_NODES.has(inner.type)) return
    if (!isErasedType(inner.typeAnnotation)) return
    if (node.loc === null || node.loc === undefined) return
    found.push({ line: node.loc.start.line, column: node.loc.start.column + 1 })
  })
  return found
}

function repositoryFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  return output
    .split('\0')
    .filter((path) => path.length > 0)
    .filter((path) => /\.(?:ts|tsx|mts|cts)$/.test(path) && existsSync(path))
}

function main(filenames) {
  const files = filenames.length > 0 ? filenames : repositoryFiles()
  const violations = []
  for (const file of files) {
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch (error) {
      console.error(`${file}: could not be read: ${error instanceof Error ? error.message : error}`)
      process.exitCode = 1
      continue
    }
    let found
    try {
      found = findDoubleAssertions(source, file)
    } catch (error) {
      console.error(
        `${file}: could not be parsed: ${error instanceof Error ? error.message : error}`,
      )
      process.exitCode = 1
      continue
    }
    for (const position of found) {
      violations.push(
        `${file}:${position.line}:${position.column}: double assertion through an erased type`,
      )
    }
  }

  for (const line of violations) console.error(line)
  if (violations.length > 0) process.exitCode = 1
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) main(process.argv.slice(2))
