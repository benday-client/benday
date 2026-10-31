import { isDid } from '@atproto/api'
import {
  appViewPresetFor,
  DEFAULT_APPVIEW,
  isAppViewTarget,
  makeCustomAppView,
  toAppViewTarget,
} from './appviews'
import { isTheme, THEME_SCHEMES } from './themes'
import type { AppViewTarget, Theme } from './types'

/** Stable filename offered by the settings export control. */
export const SETTINGS_FILE_NAME = 'benday-settings.json'

/** Bump only together with an explicit parser branch for older versions. */
export const SETTINGS_FILE_VERSION = 1

/** Mirrors the persisted labeler cap in the settings store. */
export const SETTINGS_LABELER_LIMIT = 20

/**
 * The only portable preferences. Everything else the app persists — sessions,
 * credentials, drafts, jump history, indexeddb state, profile relationships —
 * stays out of this shape and therefore out of the exported file.
 */
export type PortableAppearanceMode = 'light' | 'dark' | 'system'

export interface PortableSettings {
  theme: Theme
  appearance: PortableAppearanceMode
  lightTheme: Theme
  darkTheme: Theme
  imageEffects: boolean
  highContrast: boolean
  /** Bare single-character shortcuts; modifier chords stay available (WCAG 2.1.4). */
  keyboardShortcuts: boolean
  appView: AppViewTarget
  labelers: string[]
}

export interface SettingsFile extends PortableSettings {
  version: number
  exportedAt: string
}

export type SettingsParseResult =
  | { ok: true; settings: PortableSettings }
  | { ok: false; error: string }

/**
 * Trims a labeler did and rejects anything the SDK would refuse to put in a
 * labeler header. Validation belongs to the same predicate the wire uses.
 */
export function sanitizeLabeler(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return isDid(trimmed) ? trimmed : null
}

/**
 * Keeps valid, unique labeler dids in their original order. Non-string and
 * malformed entries are dropped, and the result is capped like the store.
 */
export function sanitizeLabelers(value: unknown, limit = SETTINGS_LABELER_LIMIT): string[] {
  if (!Array.isArray(value)) return []
  const kept = new Set<string>()
  for (const item of value) {
    if (kept.size >= limit) break
    const did = sanitizeLabeler(item)
    if (did !== null) kept.add(did)
  }
  return [...kept]
}

/**
 * Maps a stored theme to a current theme. `duotone` is the only legacy name;
 * seasonal themes are deliberately returned as-is so availability stays a
 * render-time decision rather than something baked into the file format.
 */
export function normalizeTheme(value: unknown): Theme | null {
  if (typeof value !== 'string') return null
  if (value === 'duotone') return 'cyberpunk'
  return isTheme(value) ? value : null
}

function normalizeAppearance(value: unknown): PortableAppearanceMode | null {
  return value === 'light' || value === 'dark' || value === 'system' ? value : null
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function portableAppearance(
  theme: Theme,
  appearanceValue: unknown,
  lightValue: unknown,
  darkValue: unknown,
  imageEffectValue: unknown,
  highContrastValue: unknown,
): Pick<
  PortableSettings,
  'appearance' | 'lightTheme' | 'darkTheme' | 'imageEffects' | 'highContrast'
> {
  const scheme = THEME_SCHEMES[theme]
  const lightTheme = normalizeTheme(lightValue) ?? (scheme === 'light' ? theme : ('bone' as Theme))
  const darkTheme = normalizeTheme(darkValue) ?? (scheme === 'dark' ? theme : ('void' as Theme))
  return {
    appearance: normalizeAppearance(appearanceValue) ?? scheme,
    lightTheme,
    darkTheme,
    imageEffects: normalizeBoolean(imageEffectValue, true),
    highContrast: normalizeBoolean(highContrastValue, false),
  }
}

/**
 * Rebuilds a known appview target from its host, so labels, ids and kinds in
 * an imported file cannot claim to be something the host does not provide.
 */
export function normalizeAppViewTarget(value: unknown): AppViewTarget | null {
  if (!isAppViewTarget(value)) return null
  const preset = appViewPresetFor(value)
  if (preset !== null) return toAppViewTarget(preset)
  return makeCustomAppView(value.host)
}

/** Validates and normalizes a bare portable settings snapshot. */
export function normalizePortableSettings(value: unknown): PortableSettings | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  // bracket access is deliberate: noPropertyAccessFromIndexSignature is enabled
  const theme = normalizeTheme(record['theme'])
  if (theme === null) return null
  const appView = normalizeAppViewTarget(record['appView'])
  if (appView === null) return null
  const rawLabelers = record['labelers']
  if (!Array.isArray(rawLabelers)) return null
  return {
    theme,
    ...portableAppearance(
      theme,
      record['appearance'],
      record['lightTheme'],
      record['darkTheme'],
      record['imageEffects'],
      record['highContrast'],
    ),
    keyboardShortcuts: normalizeBoolean(record['keyboardShortcuts'], true),
    appView,
    labelers: sanitizeLabelers(rawLabelers),
  }
}

/**
 * Builds the exported document from exactly the portable preferences. Extra
 * properties on the argument are ignored by construction, which keeps
 * credentials and session material from ever reaching the file.
 */
export function buildSettingsFile(settings: PortableSettings, now = new Date()): SettingsFile {
  const appView = normalizeAppViewTarget(settings.appView) ?? toAppViewTarget(DEFAULT_APPVIEW)
  const normalizedTheme = normalizeTheme(settings.theme) ?? 'void'
  return {
    version: SETTINGS_FILE_VERSION,
    exportedAt: now.toISOString(),
    theme: normalizedTheme,
    ...portableAppearance(
      normalizedTheme,
      settings.appearance,
      settings.lightTheme,
      settings.darkTheme,
      settings.imageEffects,
      settings.highContrast,
    ),
    keyboardShortcuts: normalizeBoolean(settings.keyboardShortcuts, true),
    appView,
    labelers: sanitizeLabelers(settings.labelers),
  }
}

/** Serializes a settings export; the output always has the v1 shape. */
export function serializeSettings(settings: PortableSettings, now = new Date()): string {
  return JSON.stringify(buildSettingsFile(settings, now), null, 2)
}

function fail(error: string): SettingsParseResult {
  return { ok: false, error }
}

/**
 * Parses an already-decoded settings document. Unknown top-level keys are
 * ignored, including credential-shaped ones, so a hostile or sloppy file can
 * never widen the applied state beyond the portable preferences.
 */
export function parseSettingsFile(value: unknown): SettingsParseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('settings file is not a json object')
  }
  const record = value as Record<string, unknown>

  const version = record['version']
  if (version !== SETTINGS_FILE_VERSION) {
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return fail('settings file has no valid version')
    }
    return fail(`unsupported settings file version ${version}`)
  }

  const theme = normalizeTheme(record['theme'])
  if (theme === null) return fail('settings file has an invalid theme')

  const appView = normalizeAppViewTarget(record['appView'])
  if (appView === null) return fail('settings file has an invalid appview')

  const rawLabelers = record['labelers']
  if (!Array.isArray(rawLabelers)) return fail('settings file has an invalid labeler list')

  return {
    ok: true,
    settings: {
      theme,
      ...portableAppearance(
        theme,
        record['appearance'],
        record['lightTheme'],
        record['darkTheme'],
        record['imageEffects'],
        record['highContrast'],
      ),
      keyboardShortcuts: normalizeBoolean(record['keyboardShortcuts'], true),
      appView,
      labelers: sanitizeLabelers(rawLabelers),
    },
  }
}

/** Parses raw file text, reporting json syntax problems as a plain message. */
export function parseSettingsFileJson(text: string): SettingsParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return fail('settings file is not valid json')
  }
  return parseSettingsFile(value)
}
