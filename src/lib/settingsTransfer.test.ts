import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildSettingsFile,
  normalizePortableSettings,
  type PortableSettings,
  parseSettingsFile,
  parseSettingsFileJson,
  SETTINGS_FILE_NAME,
  SETTINGS_FILE_VERSION,
  serializeSettings,
} from './settingsTransfer'
import { useSettings } from './store'

const FIXED_TIME = new Date('2026-10-30T12:00:00.000Z')

const SAMPLE: PortableSettings = {
  appearance: 'dark',
  keyboardShortcuts: true,
}

function validFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: SETTINGS_FILE_VERSION,
    exportedAt: FIXED_TIME.toISOString(),
    ...SAMPLE,
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
      ['appearance', 'exportedAt', 'keyboardShortcuts', 'version'].sort(),
    )
    expect(file.version).toBe(SETTINGS_FILE_VERSION)
    expect(file.exportedAt).toBe(FIXED_TIME.toISOString())
    expect(file.appearance).toBe('dark')
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
      appearance: 'system',
      keyboardShortcuts: null,
    })
    expect(normalized).toEqual({ appearance: 'system', keyboardShortcuts: true })
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
  }

  it('never exports fields beyond the portable preferences', () => {
    const dirty = { ...SAMPLE, ...secrets }
    const json = serializeSettings(dirty, FIXED_TIME)
    const parsed = JSON.parse(json) as Record<string, unknown>

    expect(Object.keys(parsed).sort()).toEqual(
      ['appearance', 'exportedAt', 'keyboardShortcuts', 'version'].sort(),
    )
    for (const secret of Object.values(secrets)) {
      expect(json).not.toContain(JSON.stringify(secret).slice(1, -1))
    }
  })

  it('ignores credential-shaped keys when importing a file', () => {
    const result = parseSettingsFile({ ...validFile(), ...secrets })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.settings).sort()).toEqual(['appearance', 'keyboardShortcuts'])
    expect(JSON.stringify(result.settings)).not.toContain('secret')
  })
})

describe('appearance mode', () => {
  it.each(['light', 'dark', 'system'] as const)('accepts %s', (appearance) => {
    const result = parseSettingsFile(validFile({ appearance }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings.appearance).toBe(appearance)
  })

  it('rejects an unknown or missing appearance', () => {
    for (const appearance of ['void', '', 3, null, undefined]) {
      const result = parseSettingsFile(validFile({ appearance }))
      expect(result).toEqual({ ok: false, error: 'settings file has an invalid appearance' })
      expect(normalizePortableSettings(validFile({ appearance }))).toBeNull()
    }
  })

  it('ignores a retired palette field', () => {
    const result = parseSettingsFile(validFile({ theme: 'void', lightTheme: 'bone' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings).toEqual(SAMPLE)
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

describe('settings file validation', () => {
  it('accepts a minimally valid document', () => {
    const result = parseSettingsFile(validFile())
    expect(result).toEqual({ ok: true, settings: SAMPLE })
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
})

describe('store settings import', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.setState({
      appearance: 'dark',
      theme: 'catppuccin-mocha',
      keyboardShortcuts: true,
    })
  })

  it('applies the appearance mode and its derived theme together', () => {
    const applied = useSettings.getState().importSettings({ appearance: 'light' })
    expect(applied).toBe(true)
    expect(useSettings.getState()).toMatchObject({
      appearance: 'light',
      theme: 'catppuccin-latte',
    })
  })

  it('applies every portable preference in one update', () => {
    const applied = useSettings.getState().importSettings({
      appearance: 'dark',
      keyboardShortcuts: false,
    })
    expect(applied).toBe(true)
    expect(useSettings.getState()).toMatchObject({
      appearance: 'dark',
      theme: 'catppuccin-mocha',
      keyboardShortcuts: false,
    })
  })

  it('leaves state untouched for malformed input', () => {
    const before = useSettings.getState()
    for (const value of [null, {}, { appearance: 'void' }, { appearance: 3 }]) {
      expect(useSettings.getState().importSettings(value)).toBe(false)
      const after = useSettings.getState()
      expect(after.appearance).toBe(before.appearance)
      expect(after.theme).toBe(before.theme)
      expect(after.keyboardShortcuts).toBe(before.keyboardShortcuts)
    }
  })

  it('ignores credential fields passed alongside a valid snapshot', () => {
    const applied = useSettings.getState().importSettings({
      appearance: 'dark',
      accessJwt: 'secret',
      refreshToken: 'secret',
      session: { token: 'secret' },
    })
    expect(applied).toBe(true)
    const state = useSettings.getState()
    expect('accessJwt' in state).toBe(false)
    expect('session' in state).toBe(false)
  })
})
