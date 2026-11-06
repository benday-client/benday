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

/** What a stored draft actually says, and whether storage could be read at all. */
export interface DraftRead {
  text: string
  revision: string | null
  available: boolean
}

/** A write that storage accepted, with its revision (null for a deletion). */
export type DraftWrite = { ok: true; revision: string | null } | { ok: false }

// a stored entry is only trusted when every field a draft needs is intact;
// arrays and junk values are dropped before they can reach an eviction count
function isDraftRecord(value: unknown): value is DraftRecord {
  if (!isRecord(value)) return false
  if (typeof value['text'] !== 'string') return false
  if (typeof value['updatedAt'] !== 'number' || !Number.isFinite(value['updatedAt'])) return false
  if (value['revision'] !== undefined && typeof value['revision'] !== 'string') return false
  return true
}

/**
 * The stored map, or null when storage itself cannot be read. A malformed json
 * body or a wrong top-level shape is an available empty map: there are no
 * readable entries to preserve, and a following write must not be blocked by
 * them. Null is reserved for an inaccessible store, because treating that as
 * empty would let a save erase every other account's draft.
 */
function readMap(): DraftMap | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(DRAFTS_KEY)
  } catch {
    return null
  }
  if (raw === null) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!isRecord(parsed)) return {}

  const drafts: DraftMap = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (isDraftRecord(value)) drafts[key] = value
  }
  return drafts
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

/**
 * Every draft is owned by an account: a signed-out composition has no key, and
 * a key is never written for an owner the composer does not have.
 */
export function draftKeyFor(
  mode: ComposeMode,
  targetUri: string | null,
  accountDid: string,
): string {
  return mode === 'post' ? `${accountDid}:post` : `${accountDid}:reply:${targetUri ?? ''}`
}

/**
 * Drops drafts from retired compose surfaces once at startup: signed-out
 * records and quote-mode records have no composer any more. A store that
 * cannot be read is left alone rather than rewritten. Unknown keys survive.
 */
export function purgeRetiredDrafts(): void {
  const drafts = readMap()
  if (drafts === null) return

  let changed = false
  for (const key of Object.keys(drafts)) {
    if (key.startsWith('signed-out:') || key.includes(':quote:')) {
      delete drafts[key]
      changed = true
    }
  }
  if (!changed) return
  writeMap(drafts)
}

/** Reads one entry, reporting an unreadable store instead of pretending it is empty. */
export function readDraft(key: string): DraftRead {
  const drafts = readMap()
  if (drafts === null) return { text: '', revision: null, available: false }

  const record = drafts[key]
  if (record === undefined) return { text: '', revision: null, available: true }
  // a legacy entry has no revision; null is the honest snapshot of that
  return { text: record.text, revision: record.revision ?? null, available: true }
}

/**
 * Writes nonempty text under a fresh revision. Empty text deletes the entry.
 * A deletion of an already absent entry is accepted without storage access
 * beyond the read, and a failed read or write is reported rather than hidden.
 */
export function writeDraft(key: string, text: string): DraftWrite {
  const drafts = readMap()
  if (drafts === null) return { ok: false }

  if (text.trim().length === 0) {
    if (!(key in drafts)) return { ok: true, revision: null }
    delete drafts[key]
    return writeMap(drafts) ? { ok: true, revision: null } : { ok: false }
  }

  const revision = freshRevision()
  drafts[key] = { text, updatedAt: Date.now(), revision }
  evictOldest(drafts)
  return writeMap(drafts) ? { ok: true, revision } : { ok: false }
}

/**
 * Removes the draft only when it is still the exact record this composition
 * wrote. An absent, newer or nonmatching entry has nothing left to clear, so
 * it counts as a success; false means storage could not be read or written.
 */
export function clearDraft(
  key: string,
  expectedRevision: string | null,
  expectedText: string,
): boolean {
  const drafts = readMap()
  if (drafts === null) return false

  const current = drafts[key]
  if (current === undefined) return true
  if ((current.revision ?? null) !== expectedRevision || current.text !== expectedText) return true

  delete drafts[key]
  return writeMap(drafts)
}
