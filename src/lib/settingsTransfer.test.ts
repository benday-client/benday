import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildSettingsFile,
  normalizePortableSettings,
  normalizeTheme,
  type PortableSettings,
  parseSettingsFile,
  parseSettingsFileJson,
  SETTINGS_FILE_NAME,
  SETTINGS_FILE_VERSION,
  serializeSettings,
} from './settingsTransfer'
import { useSettings } from './store'
import { THEME_SCHEMES } from './themes'
import type { Theme } from './types'

const FIXED_TIME = new Date('2026-10-30T12:00:00.000Z')

function portable(theme: Theme): PortableSettings {
  const scheme = THEME_SCHEMES[theme]
  return {
    theme,
    appearance: scheme,
    lightTheme: scheme === 'light' ? theme : 'bone',
    darkTheme: scheme === 'dark' ? theme : 'void',
    imageEffects: true,
    highContrast: false,
    keyboardShortcuts: true,
  }
}

const SAMPLE = portable('bone')

function validFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: SETTINGS_FILE_VERSION,
    exportedAt: FIXED_TIME.toISOString(),
    theme: 'bone',
    ...overrides,
  }
}

describe('settings file format', () => {
  it('keeps a stable filename and version', () => {
    expect(SETTINGS_FILE_NAME).toBe('benday-settings.json')
    expect(SETTINGS_FILE_VERSION).toBe(1)
  })

  it('writes exactly version exportedAt and the portable preferences', () => {
    const file = buildSettingsFile(SAMPLE, FIXED_TIME)
    expect(Object.keys(file).sort()).toEqual(
      [
        'appearance',
        'darkTheme',
        'exportedAt',
        'highContrast',
        'imageEffects',
        'keyboardShortcuts',
        'lightTheme',
        'theme',
        'version',
      ].sort(),
    )
    expect(file.version).toBe(SETTINGS_FILE_VERSION)
    expect(file.exportedAt).toBe(FIXED_TIME.toISOString())
    expect(file.theme).toBe('bone')
  })

  it('round-trips through serialize and parse', () => {
    const json = serializeSettings(SAMPLE, FIXED_TIME)
    const result = parseSettingsFileJson(json)
    expect(result).toEqual({ ok: true, settings: SAMPLE })

    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(parsed['version']).toBe(SETTINGS_FILE_VERSION)
    expect(parsed['exportedAt']).toBe(FIXED_TIME.toISOString())
  })

  it('normalizes the exported snapshot instead of trusting its fields', () => {
    const normalized = normalizePortableSettings({
      theme: 'duotone',
      labelers: [' did:plc:alpha ', 'did:plc:alpha', 'nope', 42, 'did:plc:beta'],
    })
    if (normalized === null) throw new Error('expected the dirty snapshot to normalize')
    const file = buildSettingsFile(normalized, FIXED_TIME)
    expect(file.theme).toBe('cyberpunk')
  })
})

describe('credential and session exclusion', () => {
  const secrets = {
    accessJwt: 'secret-access-jwt',
    refreshToken: 'secret-refresh-token',
    password: 'secret-password',
    session: { token: 'secret-session' },
    'benday:session': 'secret-storage',
    indexedDb: { portal: 'secret-portal' },
    drafts: [{ text: 'secret-draft' }],
    jumpHistory: ['secret-jump'],
    profile: { did: 'did:plc:secret', handle: 'secret.test' },
    did: 'did:plc:secret',
    handle: 'secret.test',
    appViewExtra: 'secret-appview-jwt',
  }

  it('never exports fields beyond the portable preferences', () => {
    // structurally compatible with the portable snapshot, with exactly the
    // extra keys that must never reach the file
    const dirty = { ...SAMPLE, ...secrets }
    const json = serializeSettings(dirty, FIXED_TIME)
    const parsed = JSON.parse(json) as Record<string, unknown>

    expect(Object.keys(parsed).sort()).toEqual(
      [
        'appearance',
        'darkTheme',
        'exportedAt',
        'highContrast',
        'imageEffects',
        'keyboardShortcuts',
        'lightTheme',
        'theme',
        'version',
      ].sort(),
    )
    for (const secret of Object.values(secrets)) {
      expect(json).not.toContain(JSON.stringify(secret).slice(1, -1))
    }
  })

  it('ignores credential-shaped keys when importing a file', () => {
    const result = parseSettingsFile({ ...validFile(), ...secrets })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.settings).sort()).toEqual([
      'appearance',
      'darkTheme',
      'highContrast',
      'imageEffects',
      'keyboardShortcuts',
      'lightTheme',
      'theme',
    ])
    expect(JSON.stringify(result.settings)).not.toContain('secret')
  })
})

describe('high contrast', () => {
  it('exports the option and parses it back', () => {
    const json = serializeSettings({ ...SAMPLE, highContrast: true }, FIXED_TIME)
    expect(JSON.parse(json).highContrast).toBe(true)

    const result = parseSettingsFileJson(json)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings.highContrast).toBe(true)
  })

  it('reads a file without the field as normal contrast', () => {
    const result = parseSettingsFile(validFile())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings.highContrast).toBe(false)
  })

  it('falls back to normal contrast for a wrong-typed field', () => {
    const result = parseSettingsFile(validFile({ highContrast: 'yes' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings.highContrast).toBe(false)
  })

  it('keeps legacy duotone files valid', () => {
    const result = parseSettingsFile(validFile({ theme: 'duotone' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings.theme).toBe('cyberpunk')
    expect(result.settings.highContrast).toBe(false)
  })
})

describe('keyboard shortcuts', () => {
  it('round-trips a disabled setting through the file', () => {
    const json = serializeSettings({ ...SAMPLE, keyboardShortcuts: false }, FIXED_TIME)
    expect(JSON.parse(json).keyboardShortcuts).toBe(false)

    const result = parseSettingsFileJson(json)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings.keyboardShortcuts).toBe(false)
  })

  it('exports the setting as enabled by default', () => {
    const file = buildSettingsFile(SAMPLE, FIXED_TIME)
    expect(file.keyboardShortcuts).toBe(true)
  })

  it('reads a file without the field as enabled', () => {
    // files written before the option existed must keep every shortcut working
    const result = parseSettingsFile(validFile())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings.keyboardShortcuts).toBe(true)

    const snapshot = normalizePortableSettings(validFile())
    expect(snapshot?.keyboardShortcuts).toBe(true)
  })

  it('falls back to enabled for a wrong-typed field', () => {
    for (const keyboardShortcuts of ['no', 0, null, undefined, {}, [], 1]) {
      const result = parseSettingsFile(validFile({ keyboardShortcuts }))
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.settings.keyboardShortcuts, `parsed ${String(keyboardShortcuts)}`).toBe(true)

      const snapshot = normalizePortableSettings(validFile({ keyboardShortcuts }))
      expect(snapshot?.keyboardShortcuts, `snapshot ${String(keyboardShortcuts)}`).toBe(true)
    }
  })

  it('accepts an explicit disabled setting from an imported snapshot', () => {
    const snapshot = normalizePortableSettings(validFile({ keyboardShortcuts: false }))
    expect(snapshot?.keyboardShortcuts).toBe(false)
  })
})

describe('theme normalization', () => {
  it('maps the legacy duotone name to cyberpunk', () => {
    expect(normalizeTheme('duotone')).toBe('cyberpunk')
  })

  it('keeps seasonal themes as stored without consulting a month', () => {
    expect(normalizeTheme('dead-leaves')).toBe('dead-leaves')
    expect(normalizeTheme('pumpkin-ember')).toBe('pumpkin-ember')
    const result = parseSettingsFile(validFile({ theme: 'dead-leaves' }))
    expect(result).toEqual({
      ok: true,
      settings: portable('dead-leaves'),
    })
  })

  it('rejects unknown, non-string and empty themes', () => {
    expect(normalizeTheme('neon')).toBeNull()
    expect(normalizeTheme(3)).toBeNull()
    expect(normalizeTheme(null)).toBeNull()
    for (const theme of ['neon', 3, null, undefined]) {
      const result = parseSettingsFile(validFile({ theme }))
      expect(result.ok).toBe(false)
    }
  })
})

describe('settings file validation', () => {
  it('accepts a minimally valid document', () => {
    const result = parseSettingsFile(validFile())
    expect(result).toEqual({
      ok: true,
      settings: portable('bone'),
    })
  })

  it('rejects non-object documents', () => {
    for (const value of [null, 1, 'settings', [], true]) {
      const result = parseSettingsFile(value)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe('settings file is not a json object')
    }
  })

  it('requires the current integer version', () => {
    for (const version of [undefined, 0, -1, 1.5, '1', 2, 99]) {
      const result = parseSettingsFile(validFile({ version }))
      expect(result.ok).toBe(false)
    }
    const newer = parseSettingsFile(validFile({ version: 2 }))
    expect(newer).toEqual({ ok: false, error: 'unsupported settings file version 2' })
    const missing = parseSettingsFile(validFile({ version: undefined }))
    expect(missing).toEqual({ ok: false, error: 'settings file has no valid version' })
  })

  it('reports unreadable json distinctly from invalid documents', () => {
    expect(parseSettingsFileJson('{')).toEqual({
      ok: false,
      error: 'settings file is not valid json',
    })
    expect(parseSettingsFileJson('null')).toEqual({
      ok: false,
      error: 'settings file is not a json object',
    })
  })

  it('ignores unknown top-level fields', () => {
    const result = parseSettingsFile(validFile({ extra: true, nested: { theme: 'oxide' } }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.settings).sort()).toEqual([
      'appearance',
      'darkTheme',
      'highContrast',
      'imageEffects',
      'keyboardShortcuts',
      'lightTheme',
      'theme',
    ])
  })
})

describe('store settings import', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.setState({ theme: 'void' })
  })

  it('applies the theme and its appearance together', () => {
    const applied = useSettings.getState().importSettings({ theme: 'bone' })
    expect(applied).toBe(true)
    expect(useSettings.getState()).toMatchObject({
      theme: 'bone',
      appearance: 'light',
      lightTheme: 'bone',
      darkTheme: 'void',
      imageEffects: true,
    })
  })

  it('normalizes values while importing', () => {
    const applied = useSettings.getState().importSettings({ theme: 'duotone' })
    expect(applied).toBe(true)
    expect(useSettings.getState()).toMatchObject({
      theme: 'cyberpunk',
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'cyberpunk',
      imageEffects: true,
    })
  })

  it('leaves state untouched for malformed input', () => {
    const before = useSettings.getState()
    for (const value of [null, {}, { theme: 'neon' }, { theme: 3 }]) {
      expect(useSettings.getState().importSettings(value)).toBe(false)
      const after = useSettings.getState()
      expect(after.theme).toBe(before.theme)
    }
  })

  it('ignores credential fields passed alongside a valid snapshot', () => {
    const applied = useSettings.getState().importSettings({
      theme: 'bone',
      accessJwt: 'secret',
      refreshToken: 'secret',
      session: { token: 'secret' },
    })
    expect(applied).toBe(true)
    const state = useSettings.getState()
    expect('accessJwt' in state).toBe(false)
    expect('session' in state).toBe(false)
  })

  it('accepts the normalized result of a parsed file', () => {
    const parsed = parseSettingsFile(validFile({ theme: 'oxide' }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(useSettings.getState().importSettings(parsed.settings)).toBe(true)
    expect(useSettings.getState().theme).toBe('oxide')
  })

  it('normalizes bare snapshots through normalizePortableSettings', () => {
    expect(normalizePortableSettings(SAMPLE)).toEqual(SAMPLE)
    // retired fields are ignored rather than carried into the snapshot
    expect(normalizePortableSettings({ ...SAMPLE, labelers: 'nope' })).toEqual(SAMPLE)
  })
})
