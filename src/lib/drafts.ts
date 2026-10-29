import type { ComposeMode } from './ui'

const DRAFTS_KEY = 'benday:drafts'
const MAX_DRAFTS = 20

interface DraftRecord {
  text: string
  updatedAt: number
}

type DraftMap = Record<string, DraftRecord>

function readMap(): DraftMap {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as DraftMap
  } catch {
    return {}
  }
}

function writeMap(drafts: DraftMap): void {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    // drafts are an enhancement; storage failures are harmless
  }
}

export function draftKeyFor(mode: ComposeMode, targetUri: string | null): string {
  return mode === 'post' ? 'post' : `${mode}:${targetUri ?? ''}`
}

export function readDraft(key: string): string {
  const record = readMap()[key]
  return typeof record?.text === 'string' ? record.text : ''
}

export function writeDraft(key: string, text: string): void {
  const drafts = readMap()
  if (text.trim().length === 0) {
    delete drafts[key]
    writeMap(drafts)
    return
  }

  drafts[key] = { text, updatedAt: Date.now() }
  const entries = Object.entries(drafts)
  if (entries.length > MAX_DRAFTS) {
    entries.sort((left, right) => left[1].updatedAt - right[1].updatedAt)
    for (const [oldKey] of entries.slice(0, entries.length - MAX_DRAFTS)) {
      delete drafts[oldKey]
    }
  }
  writeMap(drafts)
}

export function clearDraft(key: string): void {
  const drafts = readMap()
  if (!(key in drafts)) return
  delete drafts[key]
  writeMap(drafts)
}
