import { isRecord } from './records'
import type { ComposeMode } from './ui'

const DRAFTS_KEY = 'benday:drafts'
const MAX_DRAFTS = 20

interface DraftRecord {
  text: string
  updatedAt: number
  revision?: string
}

type DraftMap = Record<string, DraftRecord>

// a stored entry is only trusted when every field a draft needs is intact;
// arrays and junk values are dropped before they can reach an eviction count
function isDraftRecord(value: unknown): value is DraftRecord {
  if (!isRecord(value)) return false
  if (typeof value['text'] !== 'string') return false
  if (typeof value['updatedAt'] !== 'number' || !Number.isFinite(value['updatedAt'])) return false
  if (value['revision'] !== undefined && typeof value['revision'] !== 'string') return false
  return true
}

function readMap(): DraftMap {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}

    const drafts: DraftMap = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (isDraftRecord(value)) drafts[key] = value
    }
    return drafts
  } catch {
    return {}
  }
}

function writeMap(drafts: DraftMap): boolean {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
    return true
  } catch {
    return false
  }
}

function evictOldest(drafts: DraftMap): void {
  const entries = Object.entries(drafts)
  if (entries.length <= MAX_DRAFTS) return
  entries.sort((left, right) => left[1].updatedAt - right[1].updatedAt)
  for (const [oldKey] of entries.slice(0, entries.length - MAX_DRAFTS)) {
    delete drafts[oldKey]
  }
}

function freshRevision(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let revision = ''
  for (const byte of bytes) revision += byte.toString(16).padStart(2, '0')
  return revision
}

export function draftKeyFor(
  mode: ComposeMode,
  targetUri: string | null,
  accountDid: string | null,
): string {
  const owner = accountDid ?? 'signed-out'
  return mode === 'post' ? `${owner}:post` : `${owner}:${mode}:${targetUri ?? ''}`
}

export function readDraft(key: string): string {
  const record = readMap()[key]
  return typeof record?.text === 'string' ? record.text : ''
}

/**
 * Writes nonempty text under a fresh revision and returns it once storage
 * accepts the write. Empty text deletes the entry and returns null.
 */
export function writeDraft(key: string, text: string): string | null {
  const drafts = readMap()
  if (text.trim().length === 0) {
    if (!(key in drafts)) return null
    delete drafts[key]
    writeMap(drafts)
    return null
  }

  const revision = freshRevision()
  drafts[key] = { text, updatedAt: Date.now(), revision }
  evictOldest(drafts)
  return writeMap(drafts) ? revision : null
}

/**
 * Removes the draft only when it is still the exact record this composition
 * wrote. A newer revision or different text means someone else owns it now.
 */
export function clearDraft(key: string, expectedRevision: string, expectedText: string): void {
  const drafts = readMap()
  const current = drafts[key]
  if (current === undefined) return
  if (current.revision !== expectedRevision || current.text !== expectedText) return
  delete drafts[key]
  writeMap(drafts)
}
