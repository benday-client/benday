import { isRecord } from './records'
import { legacyAppearanceForTheme } from './themes'

/** Stable filename offered by the settings export control. */
export const SETTINGS_FILE_NAME = 'benday-settings.json'

/** Bump only together with an explicit parser branch for older versions. */
export const SETTINGS_FILE_VERSION = 3

/**
 * The only portable preferences. Everything else the app persists — sessions,
 * credentials, drafts, jump history, indexeddb state, profile relationships —
 * stays out of this shape and therefore out of the exported file.
 */
export type PortableAppearanceMode = 'light' | 'dark' | 'system'

export interface PortableSettings {
  appearance: PortableAppearanceMode
  /** Bare single-character shortcuts; modifier chords stay available (WCAG 2.1.4). */
  keyboardShortcuts: boolean
  /** The grunge ordered dither on static imagery. */
  imageEffects: boolean
}

export interface SettingsFile extends PortableSettings {
  version: number
  exportedAt: string
}

export type SettingsParseResult =
  | { ok: true; settings: PortableSettings }
  | { ok: false; error: string }

function normalizeAppearance(value: unknown): PortableAppearanceMode | null {
  return value === 'light' || value === 'dark' || value === 'system' ? value : null
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Validates and normalizes a bare portable settings snapshot. */
export function normalizePortableSettings(value: unknown): PortableSettings | null {
  if (!isRecord(value)) return null
  // bracket access is deliberate: noPropertyAccessFromIndexSignature is enabled
  const appearance = normalizeAppearance(value['appearance'])
  if (appearance === null) return null
  return {
    appearance,
    keyboardShortcuts: normalizeBoolean(value['keyboardShortcuts'], true),
    imageEffects: normalizeBoolean(value['imageEffects'], true),
  }
}

/**
 * Builds the exported document from exactly the portable preferences. Extra
 * properties on the argument are ignored by construction, which keeps
 * credentials and session material from ever reaching the file.
 */
export function buildSettingsFile(settings: PortableSettings, now = new Date()): SettingsFile {
  const appearance = normalizeAppearance(settings.appearance) ?? 'system'
  return {
    version: SETTINGS_FILE_VERSION,
    exportedAt: now.toISOString(),
    appearance,
    keyboardShortcuts: normalizeBoolean(settings.keyboardShortcuts, true),
    imageEffects: normalizeBoolean(settings.imageEffects, true),
  }
}

/** Serializes a settings export; the output always has the current shape. */
export function serializeSettings(settings: PortableSettings, now = new Date()): string {
  return JSON.stringify(buildSettingsFile(settings, now), null, 2)
}

function fail(error: string): SettingsParseResult {
  return { ok: false, error }
}

/**
 * Parses an already-decoded settings document. Unknown top-level keys are
 * ignored, including credential-shaped ones and the retired palette fields, so
 * a hostile or sloppy file can never widen the applied state.
 */
export function parseSettingsFile(value: unknown): SettingsParseResult {
  if (!isRecord(value)) return fail('settings file is not a json object')

  const version = value['version']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail('settings file has no valid version')
  }
  if (version > SETTINGS_FILE_VERSION) {
    return fail(`unsupported settings file version ${version}`)
  }

  // version 1 carried the retired palette fields; its mode is still explicit on
  // later exports, otherwise the old theme's scheme names the mode it painted
  const appearance =
    normalizeAppearance(value['appearance']) ?? legacyAppearanceForTheme(value['theme']) ?? 'system'

  return {
    ok: true,
    settings: {
      appearance,
      keyboardShortcuts: normalizeBoolean(value['keyboardShortcuts'], true),
      imageEffects: normalizeBoolean(value['imageEffects'], true),
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
