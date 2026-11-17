import { describe, expect, it } from 'vitest'
import { resolveSrgbColor } from '../test/colors'
import { themeColor } from './themes'
import type { Theme } from './types'

const THEMES: readonly Theme[] = ['dark', 'light']

/** A token resolved inside one scope, as the pixels it paints. */
function paintedScopeToken(scope: Element, name: string) {
  const probe = document.createElement('span')
  probe.style.color = `var(${name})`
  scope.append(probe)
  try {
    return resolveSrgbColor(getComputedStyle(probe).color)
  } finally {
    probe.remove()
  }
}

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
    const chrome = themeColor(theme)

    expect(CSS.supports('color', chrome)).toBe(true)
    expect(resolveSrgbColor(chrome)).toEqual(paintedToken('--void'))
  })
})

describe('nested theme scopes', () => {
  function scope(theme: Theme, parent?: Theme): Element {
    const node = document.createElement('div')
    node.dataset['theme'] = theme
    if (parent !== undefined) {
      const wrapper = document.createElement('div')
      wrapper.dataset['theme'] = parent
      wrapper.append(node)
      document.body.append(wrapper)
      return node
    }
    document.body.append(node)
    return node
  }

  function signature(node: Element): Record<string, string> {
    const style = getComputedStyle(node)
    const tokens = [
      '--ink',
      '--ink-dim',
      '--ink-faint',
      '--line',
      '--line-strong',
      '--paper',
      '--void',
      '--shadow',
      '--text-muted',
      '--text-link',
      '--fill-solid',
      '--on-accent',
    ]
    const result: Record<string, string> = {}
    for (const token of tokens) result[token] = style.getPropertyValue(token).trim()
    return result
  }

  it('computes the same signature standalone and nested in the other palette', () => {
    for (const theme of THEMES) {
      // never parent a theme under itself: the other palette is the parent, so
      // a leaked reset token would show up
      const parent: Theme = theme === 'dark' ? 'light' : 'dark'
      const standalone = scope(theme)
      const nested = scope(theme, parent)
      try {
        expect(signature(nested), `${theme} under ${parent}`).toEqual(signature(standalone))
        for (const token of ['--paper', '--void', '--ink', '--line', '--text-link']) {
          expect(paintedScopeToken(nested, token), `${theme} ${token}`).toEqual(
            paintedScopeToken(standalone, token),
          )
        }
      } finally {
        standalone.remove()
        nested.parentElement?.remove()
      }
    }
  })
})
