import type { AppViewCapabilities, AppViewKind, AppViewPreset, AppViewTarget } from './types'

const PRESETS = [
  {
    id: 'canonical',
    label: 'canonical',
    host: 'https://api.bsky.app',
    kind: 'official',
    note: 'official appview, direct',
    capabilities: { search: true, feeds: true },
  },
  {
    id: 'public',
    label: 'public',
    host: 'https://public.api.bsky.app',
    kind: 'official',
    note: 'cached official reads · search is not exposed',
    capabilities: { search: false, feeds: true },
  },
  {
    id: 'blacksky',
    label: 'blacksky',
    host: 'https://api.blacksky.community',
    kind: 'community',
    note: 'community appview · search is partial',
    capabilities: { search: false, feeds: true },
  },
] as const satisfies readonly AppViewPreset[]

export const APPVIEW_PRESETS: readonly AppViewPreset[] = PRESETS

export const DEFAULT_APPVIEW: AppViewPreset = PRESETS[0]

const HTTP_LOOPBACK: Record<string, true> = {
  localhost: true,
  '127.0.0.1': true,
}

const APPVIEW_KINDS: Record<AppViewKind, true> = {
  official: true,
  community: true,
  custom: true,
}

export function normalizeAppViewHost(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username !== '' || url.password !== '') return null
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null
  if (url.protocol === 'http:' && HTTP_LOOPBACK[url.hostname] !== true) return null

  return url.origin
}

export function toAppViewTarget(preset: AppViewPreset): AppViewTarget {
  return {
    id: preset.id,
    label: preset.label,
    host: preset.host,
    kind: preset.kind,
    note: preset.note,
  }
}

export function makeCustomAppView(rawHost: string): AppViewTarget | null {
  const host = normalizeAppViewHost(rawHost)
  if (host === null) return null

  const label = new URL(host).host
  return {
    id: `custom:${host}`,
    label,
    host,
    kind: 'custom',
    note: 'custom appview · public reads only',
  }
}

export function appViewPresetFor(target: AppViewTarget): AppViewPreset | null {
  return APPVIEW_PRESETS.find((preset) => preset.host === target.host) ?? null
}

export function capabilitiesFor(target: AppViewTarget): AppViewCapabilities {
  return appViewPresetFor(target)?.capabilities ?? { search: true, feeds: true }
}

export function sameAppView(left: AppViewTarget, right: AppViewTarget): boolean {
  return left.host === right.host
}

export function appViewHostname(target: AppViewTarget): string {
  return new URL(target.host).host
}

export function isAppViewTarget(value: unknown): value is AppViewTarget {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  const { id, label, host, kind, note } = record

  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof label === 'string' &&
    label.length > 0 &&
    typeof host === 'string' &&
    normalizeAppViewHost(host) === host &&
    typeof kind === 'string' &&
    Object.hasOwn(APPVIEW_KINDS, kind) &&
    typeof note === 'string'
  )
}
