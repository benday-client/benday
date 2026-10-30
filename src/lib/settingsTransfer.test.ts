import { beforeEach, describe, expect, it } from 'vitest'
import { APPVIEW_PRESETS, DEFAULT_APPVIEW, makeCustomAppView, toAppViewTarget } from './appviews'
import {
  buildSettingsFile,
  normalizeAppViewTarget,
  normalizePortableSettings,
  normalizeTheme,
  type PortableSettings,
  parseSettingsFile,
  parseSettingsFileJson,
  SETTINGS_FILE_NAME,
  SETTINGS_FILE_VERSION,
  sanitizeLabeler,
  sanitizeLabelers,
  serializeSettings,
} from './settingsTransfer'
import { useSettings } from './store'
import { THEME_SCHEMES } from './themes'
import type { AppViewTarget, Theme } from './types'

const FIXED_TIME = new Date('2026-10-30T12:00:00.000Z')

const BLACKSKY = APPVIEW_PRESETS.find((preset) => preset.id === 'blacksky')
if (BLACKSKY === undefined) throw new Error('expected the blacksky preset')

const CUSTOM = makeCustomAppView('api.example.com')
if (CUSTOM === null) throw new Error('expected a custom appview')

function portable(theme: Theme, appView: AppViewTarget, labelers: string[]): PortableSettings {
  const scheme = THEME_SCHEMES[theme]
  return {
    theme,
    appearance: scheme,
    lightTheme: scheme === 'light' ? theme : 'bone',
    darkTheme: scheme === 'dark' ? theme : 'void',
    imageEffects: true,
    appView,
    labelers,
  }
}

const SAMPLE = portable('bone', toAppViewTarget(BLACKSKY), ['did:plc:alpha', 'did:plc:beta'])

function validFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: SETTINGS_FILE_VERSION,
    exportedAt: FIXED_TIME.toISOString(),
    theme: 'bone',
    appView: toAppViewTarget(DEFAULT_APPVIEW),
    labelers: ['did:plc:alpha'],
    ...overrides,
  }
}

function requireTarget(value: AppViewTarget | null): AppViewTarget {
  if (value === null) throw new Error('expected an appview target')
  return value
}

describe('settings file format', () => {
  it('keeps a stable filename and version', () => {
    expect(SETTINGS_FILE_NAME).toBe('benday-settings.json')
    expect(SETTINGS_FILE_VERSION).toBe(1)
  })

  it('writes exactly version exportedAt and the three portable preferences', () => {
    const file = buildSettingsFile(SAMPLE, FIXED_TIME)
    expect(Object.keys(file).sort()).toEqual(
      [
        'appView',
        'appearance',
        'darkTheme',
        'exportedAt',
        'imageEffects',
        'labelers',
        'lightTheme',
        'theme',
        'version',
      ].sort(),
    )
    expect(file.version).toBe(SETTINGS_FILE_VERSION)
    expect(file.exportedAt).toBe(FIXED_TIME.toISOString())
    expect(file.theme).toBe('bone')
    expect(file.appView.host).toBe('https://api.blacksky.community')
    expect(file.labelers).toEqual(['did:plc:alpha', 'did:plc:beta'])
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
    const dirty = {
      theme: 'duotone',
      appView: CUSTOM,
      labelers: [' did:plc:alpha ', 'did:plc:alpha', 'nope', 42, 'did:plc:beta'],
    } as unknown as PortableSettings
    const file = buildSettingsFile(dirty, FIXED_TIME)
    expect(file.theme).toBe('cyberpunk')
    expect(file.appView.kind).toBe('custom')
    expect(file.labelers).toEqual(['did:plc:alpha', 'did:plc:beta'])
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

  it('never exports fields beyond theme appview and labelers', () => {
    const dirty = {
      ...SAMPLE,
      ...secrets,
      appView: { ...SAMPLE.appView, accessJwt: secrets.appViewExtra },
    } as unknown as PortableSettings
    const json = serializeSettings(dirty, FIXED_TIME)
    const parsed = JSON.parse(json) as Record<string, unknown>

    expect(Object.keys(parsed).sort()).toEqual(
      [
        'appView',
        'appearance',
        'darkTheme',
        'exportedAt',
        'imageEffects',
        'labelers',
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
      'appView',
      'appearance',
      'darkTheme',
      'imageEffects',
      'labelers',
      'lightTheme',
      'theme',
    ])
    expect(JSON.stringify(result.settings)).not.toContain('secret')
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
      settings: portable('dead-leaves', toAppViewTarget(DEFAULT_APPVIEW), ['did:plc:alpha']),
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

describe('appview normalization', () => {
  it('rebuilds a known preset from its host instead of trusting labels', () => {
    const spoofed = {
      id: 'spoof',
      label: 'spoof',
      host: 'https://api.blacksky.community',
      kind: 'official',
      note: 'spoof',
    }
    expect(normalizeAppViewTarget(spoofed)).toEqual(toAppViewTarget(BLACKSKY))
  })

  it('turns an unknown https host into a custom target', () => {
    const normalized = requireTarget(
      normalizeAppViewTarget({
        id: 'whatever',
        label: 'whatever',
        host: 'https://api.example.com',
        kind: 'official',
        note: 'whatever',
      }),
    )
    expect(normalized).toEqual(CUSTOM)
    expect(normalized.kind).toBe('custom')
  })

  it('rejects targets with unusable hosts', () => {
    expect(normalizeAppViewTarget({ ...CUSTOM, host: 'https://api.example.com/path' })).toBeNull()
    expect(normalizeAppViewTarget({ ...CUSTOM, host: 'http://api.example.com' })).toBeNull()
    expect(normalizeAppViewTarget('https://api.example.com')).toBeNull()
    expect(normalizeAppViewTarget(null)).toBeNull()
  })

  it('reports an invalid appview in a settings file', () => {
    const result = parseSettingsFile(validFile({ appView: { host: 'nope' } }))
    expect(result).toEqual({ ok: false, error: 'settings file has an invalid appview' })
  })
})

describe('labeler sanitization', () => {
  it('trims and validates individual dids', () => {
    expect(sanitizeLabeler('  did:plc:alpha  ')).toBe('did:plc:alpha')
    expect(sanitizeLabeler('did:')).toBeNull()
    expect(sanitizeLabeler('https://example.com')).toBeNull()
    expect(sanitizeLabeler(7)).toBeNull()
  })

  it('drops invalid entries, deduplicates and keeps order', () => {
    expect(
      sanitizeLabelers([
        'did:plc:alpha',
        ' did:plc:alpha ',
        'nope',
        'did:plc:beta',
        null,
        12,
        '',
        'did:plc:gamma',
      ]),
    ).toEqual(['did:plc:alpha', 'did:plc:beta', 'did:plc:gamma'])
  })

  it('caps the list at the store limit', () => {
    const many = Array.from({ length: 25 }, (_, index) => `did:plc:${index}`)
    const kept = sanitizeLabelers(many)
    expect(kept).toHaveLength(20)
    expect(kept[0]).toBe('did:plc:0')
    expect(kept[19]).toBe('did:plc:19')
  })

  it('returns an empty list for non-arrays', () => {
    expect(sanitizeLabelers('did:plc:alpha')).toEqual([])
    expect(sanitizeLabelers(null)).toEqual([])
  })
})

describe('settings file validation', () => {
  it('accepts a minimally valid document', () => {
    const result = parseSettingsFile(validFile())
    expect(result).toEqual({
      ok: true,
      settings: portable('bone', toAppViewTarget(DEFAULT_APPVIEW), ['did:plc:alpha']),
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

  it('rejects malformed labeler lists but tolerates junk entries', () => {
    expect(parseSettingsFile(validFile({ labelers: 'did:plc:alpha' }))).toEqual({
      ok: false,
      error: 'settings file has an invalid labeler list',
    })

    const mixed = parseSettingsFile(validFile({ labelers: ['did:plc:alpha', 8, 'junk'] }))
    expect(mixed).toEqual({
      ok: true,
      settings: portable('bone', toAppViewTarget(DEFAULT_APPVIEW), ['did:plc:alpha']),
    })
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
      'appView',
      'appearance',
      'darkTheme',
      'imageEffects',
      'labelers',
      'lightTheme',
      'theme',
    ])
  })
})

describe('store settings import', () => {
  const baseAppView = toAppViewTarget(DEFAULT_APPVIEW)

  beforeEach(() => {
    localStorage.clear()
    useSettings.setState({ theme: 'void', appView: baseAppView, labelers: [] })
  })

  it('applies theme appview and labelers together', () => {
    const applied = useSettings.getState().importSettings({
      theme: 'bone',
      appView: toAppViewTarget(BLACKSKY),
      labelers: ['did:plc:alpha', 'did:plc:beta'],
    })
    expect(applied).toBe(true)
    expect(useSettings.getState()).toMatchObject({
      theme: 'bone',
      appearance: 'light',
      lightTheme: 'bone',
      darkTheme: 'void',
      imageEffects: true,
      appView: { host: 'https://api.blacksky.community' },
      labelers: ['did:plc:alpha', 'did:plc:beta'],
    })
  })

  it('normalizes values while importing', () => {
    const applied = useSettings.getState().importSettings({
      theme: 'duotone',
      appView: CUSTOM,
      labelers: [' did:plc:alpha ', 'did:plc:alpha', 'nope', 'did:plc:beta'],
    })
    expect(applied).toBe(true)
    expect(useSettings.getState()).toMatchObject({
      theme: 'cyberpunk',
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'cyberpunk',
      imageEffects: true,
      appView: { kind: 'custom', host: 'https://api.example.com' },
      labelers: ['did:plc:alpha', 'did:plc:beta'],
    })
  })

  it('leaves state untouched for malformed input', () => {
    const before = useSettings.getState()
    for (const value of [
      null,
      {},
      { theme: 'neon', appView: baseAppView, labelers: [] },
      { theme: 'bone', appView: { host: 'nope' }, labelers: [] },
      { theme: 'bone', appView: baseAppView, labelers: 'did:plc:alpha' },
      { theme: 'bone', appView: baseAppView },
    ]) {
      expect(useSettings.getState().importSettings(value)).toBe(false)
      const after = useSettings.getState()
      expect(after.theme).toBe(before.theme)
      expect(after.appView).toBe(before.appView)
      expect(after.labelers).toBe(before.labelers)
    }
  })

  it('ignores credential fields passed alongside a valid snapshot', () => {
    const applied = useSettings.getState().importSettings({
      theme: 'bone',
      appView: baseAppView,
      labelers: ['did:plc:alpha'],
      accessJwt: 'secret',
      refreshToken: 'secret',
      session: { token: 'secret' },
    })
    expect(applied).toBe(true)
    const state = useSettings.getState() as unknown as Record<string, unknown>
    expect(state['accessJwt']).toBeUndefined()
    expect(state['session']).toBeUndefined()
    expect(state['labelers']).toEqual(['did:plc:alpha'])
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
    expect(normalizePortableSettings({ ...SAMPLE, labelers: 'nope' })).toBeNull()
  })
})
