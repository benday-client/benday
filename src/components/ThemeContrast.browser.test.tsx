import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { notificationsQueryKey } from '../hooks/useNotifications'
import { useAuthStore } from '../lib/auth'
import type { NotificationModel } from '../lib/notifications'
import { useSettings } from '../lib/store'
import { THEMES } from '../lib/themes'
import type { PostModel, Theme } from '../lib/types'
import { resolveSrgbColor } from '../test/colors'
import { longPostFixture, postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { renderStage } from '../test/stage'
import { installTransport, jsonResponse } from '../test/transport'
import NotificationsView from '../views/NotificationsView'
import { Deck } from './Deck'
import { DitherDefs } from './DitherDefs'
import { HelpDialog } from './HelpDialog'
import { PostCard } from './PostCard'
import { RelativeTime } from './RelativeTime'
import { SettingsDialog } from './SettingsDialog'
import { ThemePreview } from './ThemePreview'
import { Button, EmptyState, ErrorNotice, Frame, Progress, Tag, TextInput } from './ui'

/* colour maths -------------------------------------------------------- */

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const OPAQUE_WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }

/**
 * Reads the painted colour of anything the browser can parse, so a computed
 * `rgb()`, `color(srgb …)` or `oklch(…)` serialization compares as pixels
 * rather than as a string format.
 */
function parseColor(input: string): Rgba {
  return resolveSrgbColor(input)
}

function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a)
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a,
  }
}

function linear(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(color: Rgba): number {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
}

function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The painted surface behind an element, compositing every transparent layer. */
function surfaceOf(element: Element): Rgba {
  const layers: Rgba[] = []
  let node: Element | null = element
  while (node !== null) {
    const layer = parseColor(getComputedStyle(node).backgroundColor)
    layers.push(layer)
    if (layer.a >= 1) break
    node = node.parentElement
  }

  let surface = OPAQUE_WHITE
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index]
    if (layer !== undefined) surface = composite(layer, surface)
  }
  return surface
}

/** Contrast of an element's computed text colour over its real surface. */
function textContrast(element: Element, pseudo?: string): number {
  const fg = parseColor(getComputedStyle(element, pseudo).color)
  const bg = surfaceOf(element)
  return contrast(composite(fg, bg), bg)
}

/** Contrast of a control's own foreground against its own fill. */
function fillContrast(element: Element): number {
  const style = getComputedStyle(element)
  return contrast(parseColor(style.color), parseColor(style.backgroundColor))
}

/** Contrast of the outline treatment against the surface it sits on. */
function outlineContrast(element: Element): number {
  const outline = parseColor(getComputedStyle(element).outlineColor)
  return contrast(outline, surfaceOf(element))
}

function must<T extends Element | null>(value: T): NonNullable<T> {
  if (value === null) throw new Error('element did not render')
  return value as NonNullable<T>
}

const SURFACE_TOKENS = ['--void', '--paper', '--panel', '--panel-raised'] as const

function renderCatalogue(theme: Theme, highContrast: boolean) {
  document.documentElement.dataset['theme'] = theme
  document.documentElement.dataset['contrast'] = highContrast ? 'high' : 'normal'
  return renderStage(
    <>
      <Frame label="catalogue" meta="now">
        <p className="b-post-card__text">
          body text <a href="#catalogue">catalogue reference</a>
        </p>
        <Button variant="solid">post</Button>
        <Button variant="outline">outline</Button>
        <Button variant="ghost">ghost</Button>
        <TextInput
          label="search"
          hint="try a handle"
          placeholder="search"
          value=""
          onChange={() => {}}
        />
        <Tag>default</Tag>
        <Tag tone="accent">accent</Tag>
        <Tag tone="warn">warn</Tag>
        <RelativeTime iso="2026-10-31T12:00:00.000Z" />
        <Progress label="loading posts" indeterminate />
      </Frame>
      <ErrorNotice message="couldn't load this feed" onRetry={() => {}} />
      <EmptyState title="no cards" hint="nothing to show here yet" />
      {SURFACE_TOKENS.map((token) => (
        <div
          key={token}
          data-focus-surface={token}
          style={{ background: `var(${token})`, outline: '1px solid var(--blue)' }}
        >
          focus line
        </div>
      ))}
      <div
        data-probe="solid-hover"
        style={{ background: 'var(--fill-solid-hover)', color: 'var(--on-accent)' }}
      >
        hover
      </div>
      <div
        data-probe="selection"
        style={{ background: 'var(--fill-solid)', color: 'var(--selection-ink)' }}
      >
        selected
      </div>
    </>,
  )
}

for (const theme of THEMES) {
  for (const highContrast of [false, true]) {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      const mode = highContrast ? 'high contrast' : 'normal'
      // the AA floor is 4.5; the high variant is a genuine AAA surface, so it
      // must clear 7 rather than merely the normal floor
      const minimum = highContrast ? 7 : 4.5

      it(`keeps ${theme} readable in ${mode} at ${viewport.width}x${viewport.height}`, async () => {
        await page.viewport(viewport.width, viewport.height)
        const { container, unmount } = renderCatalogue(theme, highContrast)
        const scope = container

        const checks: Array<[string, number]> = [
          ['frame label', textContrast(must(scope.querySelector('.b-frame__label')))],
          ['frame meta', textContrast(must(scope.querySelector('.b-frame__meta')))],
          ['body text', textContrast(must(scope.querySelector('.b-post-card__text')))],
          ['prose link', textContrast(must(scope.querySelector('a')))],
          ['solid button', fillContrast(must(scope.querySelector('.b-button--solid')))],
          ['outline button', textContrast(must(scope.querySelector('.b-button--outline')))],
          ['ghost button', textContrast(must(scope.querySelector('.b-button--ghost')))],
          ['input hint', textContrast(must(scope.querySelector('.b-input__hint')))],
          [
            'input placeholder',
            textContrast(must(scope.querySelector('.b-input__control')), '::placeholder'),
          ],
          ['default tag', textContrast(must(scope.querySelector('.b-tag--default')))],
          ['accent tag', textContrast(must(scope.querySelector('.b-tag--accent')))],
          ['warn tag', textContrast(must(scope.querySelector('.b-tag--warn')))],
          ['error message', textContrast(must(scope.querySelector('.b-error__message')))],
          ['empty hint', textContrast(must(scope.querySelector('.b-empty__hint')))],
          ['relative time', textContrast(must(scope.querySelector('.b-relative-time')))],
          ['progress label', textContrast(must(scope.querySelector('.b-progress__label')))],
          ['solid hover', fillContrast(must(scope.querySelector('[data-probe="solid-hover"]')))],
          ['selection', fillContrast(must(scope.querySelector('[data-probe="selection"]')))],
        ]

        for (const [label, value] of checks) {
          expect(value, `${theme} ${mode}: ${label}`).toBeGreaterThanOrEqual(minimum)
        }

        for (const surface of scope.querySelectorAll<HTMLElement>('[data-focus-surface]')) {
          const name = surface.dataset['focusSurface'] ?? 'surface'
          expect(
            outlineContrast(surface),
            `${theme} ${mode}: focus line on ${name}`,
          ).toBeGreaterThanOrEqual(3)
        }

        unmount()
      })
    }
  }
}

/* split preview scope ------------------------------------------------ */

/**
 * The colour a role resolves to inside a theme scope. The raw custom property
 * may be a `var()` alias, so a probe element is the only way to read what the
 * cascade actually computed for that scope.
 */
function scopedRoleColor(scope: Element, property: '--text-muted' | '--text-link'): string {
  const probe = document.createElement('span')
  probe.style.color = `var(${property})`
  scope.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

describe('split preview role scoping', () => {
  it('lets each half resolve its own roles under a different root', () => {
    document.documentElement.dataset['theme'] = 'void'
    document.documentElement.dataset['contrast'] = 'normal'
    // both halves differ from the void root, so any leaked parent alias shows
    // up as the root palette appearing inside a half
    useSettings.setState({
      appearance: 'system',
      lightTheme: 'catppuccin-latte',
      darkTheme: 'cyberpunk',
      imageEffects: true,
    })
    const { container, unmount } = render(
      <>
        <DitherDefs />
        <ThemePreview />
      </>,
    )
    const halves = [...container.querySelectorAll<HTMLElement>('.b-theme-preview__half')]
    expect(halves).toHaveLength(2)
    expect(container.querySelector('.b-theme-preview--split')).not.toBeNull()
    const [lightHalf, darkHalf] = halves
    if (lightHalf === undefined || darkHalf === undefined) throw new Error('halves missing')

    const rootMuted = scopedRoleColor(document.documentElement, '--text-muted')
    const rootLink = scopedRoleColor(document.documentElement, '--text-link')

    for (const half of halves) {
      const theme = half.dataset['theme'] ?? ''
      const muted = scopedRoleColor(half, '--text-muted')
      const link = scopedRoleColor(half, '--text-link')

      expect(muted, `${theme} muted resolves inside its half`).not.toBe('')
      expect(link, `${theme} link resolves inside its half`).not.toBe('')

      // real consumers read the half's own role, not the root's
      expect(getComputedStyle(must(half.querySelector('.b-theme-preview__meta'))).color).toBe(muted)
      expect(getComputedStyle(must(half.querySelector('.b-theme-preview__label'))).color).toBe(
        muted,
      )
      expect(getComputedStyle(must(half.querySelector('.b-theme-preview__link'))).color).toBe(link)

      // every specimen face stays readable on the half's own surface
      expect(
        textContrast(must(half.querySelector('.b-theme-preview__text'))),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        textContrast(must(half.querySelector('.b-theme-preview__meta'))),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        textContrast(must(half.querySelector('.b-theme-preview__link'))),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        textContrast(must(half.querySelector('.b-theme-preview__input'))),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        fillContrast(must(half.querySelector('.b-theme-preview__controls .b-button--solid'))),
      ).toBeGreaterThanOrEqual(4.5)

      // a mounted DitherDefs makes each half's image filter resolvable
      const image = must(half.querySelector<HTMLElement>('.b-theme-preview__image'))
      const effect = image.dataset['effect'] ?? 'none'
      if (effect !== 'none') {
        expect(getComputedStyle(image).filter).toContain(`#benday-dither-${theme}`)
        expect(document.querySelector(`#benday-dither-${theme}`)).not.toBeNull()
      }
    }

    expect(rootMuted).not.toBe('')
    expect(rootLink).not.toBe('')
    // the ink-link light half and the accent-link dark half must not collapse
    // to one inherited alias
    const lightLink = scopedRoleColor(lightHalf, '--text-link')
    const darkLink = scopedRoleColor(darkHalf, '--text-link')
    expect(lightLink).not.toBe(darkLink)
    unmount()
  })
})
/* layout invariants -------------------------------------------------- */

async function settle(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
  return promise
}

function cardOf(container: HTMLElement, index: number): HTMLElement {
  const card = container.querySelector<HTMLElement>(`[data-deck-index="${index}"]`)
  if (card === null) throw new Error(`card ${index} missing`)
  return card
}

function deckOf(container: HTMLElement): HTMLElement {
  const deck = container.querySelector<HTMLElement>('.b-deck')
  if (deck === null) throw new Error('deck missing')
  return deck
}

function renderPostDeck(posts: readonly PostModel[], layout: 'deck' | 'list') {
  const client = createTestQueryClient()
  const memory = memoryLocation({ path: '/feed', record: true })
  return renderStage(
    <QueryClientProvider client={client}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <section className="b-view">
          <div className="b-view__body">
            <Deck
              items={posts}
              getKey={(item) => item.uri}
              renderItem={(item, index, focused) => (
                <PostCard post={item} index={index} focused={focused} />
              )}
              layout={layout}
              label="cards"
            />
          </div>
        </section>
      </Router>
    </QueryClientProvider>,
  )
}

describe('layout invariants', () => {
  it('keeps the tile floor with the footer inside a reachable body at 320x256', async () => {
    await page.viewport(320, 256)
    const long = longPostFixture({
      uri: 'at://did:plc:test/app.bsky.feed.post/long-geometry',
      text: Array.from({ length: 60 }, (_, index) => `line ${index} of the long tile body`).join(
        '\n',
      ),
    })
    const { container, unmount } = renderPostDeck([long, postFixture()], 'deck')
    await settle()

    const deck = deckOf(container)
    expect(deck.dataset['axis']).toBe('y')
    expect(deck.dataset['layout']).toBe('deck')

    const item = cardOf(container, 0)
    const itemBox = item.getBoundingClientRect()
    expect(itemBox.height).toBeGreaterThanOrEqual(319)

    const card = must(item.querySelector<HTMLElement>('.b-post-card'))
    const body = must(item.querySelector<HTMLElement>('.b-post-card__body'))
    const foot = must(item.querySelector<HTMLElement>('.b-post-card__foot'))

    // the tile clips itself, not the footer: the body scrolls inside it
    expect(getComputedStyle(card).overflow).toBe('hidden')
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)

    const footBox = foot.getBoundingClientRect()
    expect(footBox.top).toBeGreaterThanOrEqual(itemBox.top - 1)
    expect(footBox.bottom).toBeLessThanOrEqual(itemBox.bottom + 1)

    body.scrollTop = body.scrollHeight
    await settle()
    expect(body.scrollTop).toBeGreaterThan(0)
    expect(body.scrollHeight - body.scrollTop - body.clientHeight).toBeLessThanOrEqual(1)
    unmount()
  })

  it('keeps two normal-height tiles visible at 390x844', async () => {
    await page.viewport(390, 844)
    const { container, unmount } = renderPostDeck(
      [
        postFixture({ uri: 'at://did:plc:test/app.bsky.feed.post/a', text: 'short card body' }),
        postFixture({ uri: 'at://did:plc:test/app.bsky.feed.post/b', text: 'second card body' }),
        postFixture({ uri: 'at://did:plc:test/app.bsky.feed.post/c', text: 'third card body' }),
      ],
      'deck',
    )
    await settle()

    const deck = deckOf(container)
    expect(deck.dataset['axis']).toBe('y')
    const first = cardOf(container, 0).getBoundingClientRect()
    const second = cardOf(container, 1).getBoundingClientRect()
    const gap = Number.parseFloat(getComputedStyle(deck).rowGap)

    expect(first.height).toBeGreaterThanOrEqual(320)
    // two tiles and their gap fit the deck, so the pair stays in view together
    expect(first.height + gap + second.height).toBeLessThanOrEqual(deck.clientHeight + 2)
    expect(second.top).toBeGreaterThanOrEqual(first.bottom)
    unmount()
  })

  it('switches the deck axis exactly at 900px', async () => {
    const { container, unmount } = renderPostDeck([postFixture()], 'deck')
    await settle()

    await page.viewport(899, 800)
    await vi.waitFor(() => {
      expect(deckOf(container).dataset['axis']).toBe('y')
    })

    await page.viewport(900, 800)
    await vi.waitFor(() => {
      expect(deckOf(container).dataset['axis']).toBe('x')
    })

    await page.viewport(1280, 800)
    await vi.waitFor(() => {
      expect(deckOf(container).dataset['axis']).toBe('x')
    })
    unmount()
  })

  it('keeps notification rows content-height and caps the deck column', async () => {
    await page.viewport(800, 800)
    const transport = installTransport()
    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.createSession', () =>
      jsonResponse(200, SESSION),
    )
    const signedIn = await useAuthStore.getState().signIn('alice.test', 'app-pass', PDS)
    expect(signedIn).toBe(true)

    const rows = [notificationRow('one'), notificationRow('two'), notificationRow('three')]
    const client = createTestQueryClient()
    // seed and mount in the same task: gcTime is zero in the test client, so an
    // awaited gap would let the unobserve cache entry be collected
    client.setQueryData(notificationsQueryKey(VIEWER_DID), {
      notifications: rows,
      newestIndexedAt: null,
    })
    const memory = memoryLocation({ path: '/notifications', record: true })
    const { container, unmount } = renderStage(
      <QueryClientProvider client={client}>
        <Router hook={memory.hook} searchHook={memory.searchHook}>
          <NotificationsView />
        </Router>
      </QueryClientProvider>,
    )
    await settle()

    const deck = deckOf(container)
    expect(deck.dataset['layout']).toBe('list')
    expect(deck.dataset['axis']).toBe('y')

    const listRow = cardOf(container, 0)
    expect(getComputedStyle(listRow).flexBasis).toBe('auto')
    // content height, not half of a short deck and not the 320px tile floor
    expect(listRow.getBoundingClientRect().height).toBeLessThan(320)

    await page.viewport(1000, 800)
    await vi.waitFor(() => {
      expect(deck.getBoundingClientRect().width).toBeCloseTo(980, 0)
    })

    await page.viewport(1280, 800)
    await vi.waitFor(() => {
      expect(deck.getBoundingClientRect().width).toBeCloseTo(1040, 0)
    })
    unmount()
  })

  it('never scrolls the page horizontally for dialogs or help between 320 and 2560', async () => {
    const widths = [320, 390, 800, 899, 900, 1280, 2560]
    for (const width of widths) {
      await page.viewport(width, 844)
      await settle()
      await document.fonts.ready

      const help = render(
        <QueryClientProvider client={createTestQueryClient()}>
          <HelpDialog open onClose={() => {}} />
        </QueryClientProvider>,
      )
      await settle()
      expect(
        document.documentElement.scrollWidth,
        `help page width at ${width}`,
      ).toBeLessThanOrEqual(window.innerWidth + 1)
      const dialog = must(document.querySelector<HTMLElement>('.b-dialog'))
      const dialogBox = dialog.getBoundingClientRect()
      expect(dialogBox.left, `help left at ${width}`).toBeGreaterThanOrEqual(-1)
      expect(dialogBox.right, `help right at ${width}`).toBeLessThanOrEqual(width + 1)
      for (const row of document.querySelectorAll<HTMLElement>('.b-help__row')) {
        expect(row.scrollWidth, `help row at ${width}`).toBeLessThanOrEqual(row.clientWidth + 1)
      }
      for (const key of document.querySelectorAll<HTMLElement>('.b-help__keys .b-kbd')) {
        expect(key.getBoundingClientRect().right, `help key at ${width}`).toBeLessThanOrEqual(
          dialogBox.right + 1,
        )
      }
      help.unmount()

      const settings = render(
        <QueryClientProvider client={createTestQueryClient()}>
          <SettingsDialog open onClose={() => {}} />
        </QueryClientProvider>,
      )
      await settle()
      expect(
        document.documentElement.scrollWidth,
        `settings page width at ${width}`,
      ).toBeLessThanOrEqual(window.innerWidth + 1)
      const settingsDialog = must(document.querySelector<HTMLElement>('.b-dialog'))
      const settingsBox = settingsDialog.getBoundingClientRect()
      expect(settingsBox.left, `settings left at ${width}`).toBeGreaterThanOrEqual(-1)
      expect(settingsBox.right, `settings right at ${width}`).toBeLessThanOrEqual(width + 1)
      expect(settingsDialog.scrollWidth, `settings content at ${width}`).toBeLessThanOrEqual(
        settingsDialog.clientWidth + 1,
      )
      settings.unmount()
    }
  })
})

/* notification fixture ------------------------------------------------- */

const PDS = 'https://pds.test'
const VIEWER_DID = 'did:plc:alice'

const SESSION = {
  did: VIEWER_DID,
  handle: 'alice.test',
  accessJwt: 'alice-access',
  refreshJwt: 'alice-refresh',
  active: true,
}

function notificationRow(id: string): NotificationModel {
  return {
    id,
    uri: `at://did:plc:test/app.bsky.feed.like/${id}`,
    reason: 'like',
    author: {
      did: `did:plc:${id}`,
      handle: `${id}.test`,
      displayName: `${id} author`,
      avatar: null,
      muted: false,
      blocked: false,
    },
    subject: 'at://did:plc:test/app.bsky.feed.post/subject',
    subjectText: `subject text for ${id}`,
    subjectPost: null,
    isRead: true,
    indexedAt: '2026-10-29T12:00:00.000Z',
  }
}
