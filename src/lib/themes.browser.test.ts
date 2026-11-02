import { describe, expect, it } from 'vitest'
import { resolveSrgbColor } from '../test/colors'
import { THEMES, themeColor } from './themes'
import type { Theme } from './types'

/** A theme token as the page actually paints it. */
function paintedToken(name: string) {
  const probe = document.createElement('span')
  probe.setAttribute('style', `position:absolute;left:-9999px;color:var(${name})`)
  document.body.append(probe)
  try {
    return resolveSrgbColor(getComputedStyle(probe).color)
  } finally {
    probe.remove()
  }
}

describe('theme chrome colour', () => {
  it.each(THEMES)('matches the painted page for %s', (theme: Theme) => {
    document.documentElement.dataset['theme'] = theme
    const chrome = themeColor(theme, false)

    expect(CSS.supports('color', chrome)).toBe(true)
    expect(resolveSrgbColor(chrome)).toEqual(paintedToken('--void'))
  })

  it('keeps high-contrast chrome at the painted black or white page', () => {
    document.documentElement.dataset['contrast'] = 'high'
    try {
      for (const theme of THEMES) {
        document.documentElement.dataset['theme'] = theme
        expect(resolveSrgbColor(themeColor(theme, true))).toEqual(paintedToken('--void'))
      }
    } finally {
      delete document.documentElement.dataset['contrast']
    }
  })
})
