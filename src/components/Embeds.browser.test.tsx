import { act, render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { EmbedModel, ImageModel, VideoEmbed } from '../lib/types'
import { Embeds } from './Embeds'

const BROKEN = 'data:image/png;base64,AAAA'

/**
 * The player imports hls.js only when a poster is activated. The fake keeps a
 * real browser case off the network and lets the test reach the paused state
 * the CSS contract describes.
 */
const hls = vi.hoisted(() => {
  const handlers = new Map<string, (event: string, data: { fatal: boolean }) => void>()
  class FakeHls {
    static isSupported = () => true
    static Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' }
    on = (event: string, handler: (event: string, data: { fatal: boolean }) => void) => {
      handlers.set(event, handler)
    }
    loadSource = () => {}
    attachMedia = () => {}
    startLoad = () => {}
    stopLoad = () => {}
    destroy = () => {}
  }
  return { handlers, FakeHls }
})

vi.mock('hls.js', () => ({ default: hls.FakeHls }))

const video: VideoEmbed = {
  type: 'video',
  thumbnail: BROKEN,
  alt: 'a clip',
  playlist: 'https://example.test/clip.m3u8',
}

function quoted(text: string) {
  return {
    uri: 'at://did:plc:quoted/app.bsky.feed.post/1',
    cid: 'quoted-cid',
    author: {
      did: 'did:plc:quoted',
      handle: 'quoted.test',
      displayName: 'quoted',
      avatar: null,
      muted: false,
      blocked: false,
    },
    text,
    facets: [],
    indexedAt: '2026-10-29T12:00:00.000Z',
    embedType: 'app.bsky.embed.record#view',
  }
}

function brokenImage(alt: string, width: number | null = null, height: number | null = null) {
  const image: ImageModel = { thumb: BROKEN, fullsize: BROKEN, alt, width, height }
  return image
}

function renderEmbed(hostWidth: number, embed: EmbedModel, concealed = false) {
  return render(
    <div data-testid="host" style={{ width: `${hostWidth}px` }}>
      <Embeds embed={embed} concealed={concealed} />
    </div>,
  )
}

function requireElement<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new Error(`${selector} missing`)
  return element
}

async function assertDeclaredSingle(width: number, hostWidth: number) {
  await page.viewport(width, 900)
  const { container } = renderEmbed(hostWidth, {
    type: 'images',
    images: [brokenImage('a broken image', 800, 400)],
  })

  await waitFor(() => {
    expect(container.querySelectorAll('.dither-image--fallback').length).toBe(1)
  })

  const grid = requireElement(container, '.b-embed__grid')
  const frame = requireElement(container, '.b-embed__image-frame')
  const fallback = requireElement(container, '.dither-image--fallback')

  const gridWidth = grid.getBoundingClientRect().width
  // a usable grid width first, so a collapsed box cannot satisfy the rest
  expect(gridWidth).toBeGreaterThan(200)

  const expected = Math.min(800, gridWidth - 2)
  const frameRect = frame.getBoundingClientRect()
  const fallbackRect = fallback.getBoundingClientRect()

  expect(Math.abs(frameRect.width - expected)).toBeLessThanOrEqual(2)
  expect(Math.abs(fallbackRect.width - expected)).toBeLessThanOrEqual(2)
  expect(Math.abs(frameRect.height - frameRect.width / 2)).toBeLessThanOrEqual(2)
  expect(Math.abs(fallbackRect.height - fallbackRect.width / 2)).toBeLessThanOrEqual(2)
}

it('reserves a declared single image frame after its error at 1280px', async () => {
  await assertDeclaredSingle(1280, 900)
})

it('reserves a declared single image frame after its error at 390px', async () => {
  await assertDeclaredSingle(390, 358)
})

it('keeps 4:3 frames for a failed two-image grid', async () => {
  await page.viewport(1280, 900)
  const { container } = renderEmbed(900, {
    type: 'images',
    images: [brokenImage('first broken image'), brokenImage('second broken image')],
  })

  await waitFor(() => {
    expect(container.querySelectorAll('.dither-image--fallback').length).toBe(2)
  })

  const frames = container.querySelectorAll('.b-embed__image-frame')
  expect(frames.length).toBe(2)
  for (const frame of frames) {
    const rect = frame.getBoundingClientRect()
    expect(rect.width).toBeGreaterThan(100)
    expect(Math.abs(rect.height - rect.width * 0.75)).toBeLessThanOrEqual(2)
  }
})

it('refuses focus inside a concealed grid and restores it after reveal', async () => {
  await page.viewport(390, 844)
  const embed: EmbedModel = {
    type: 'images',
    images: [
      {
        thumb: BROKEN,
        // a real destination keeps the image link focusable, which is exactly
        // what inert must refuse while the media is concealed
        fullsize: 'https://cdn.test/full.jpg',
        alt: 'a concealed caption',
        width: 800,
        height: 400,
      },
    ],
  }
  const { container, rerender } = renderEmbed(358, embed, true)

  const figure = requireElement<HTMLElement>(container, 'figure.b-embed--images')
  const link = requireElement<HTMLAnchorElement>(container, 'a.b-embed__image-link')

  expect(figure.inert).toBe(true)
  expect(figure.getAttribute('aria-hidden')).toBe('true')
  // chromium itself refuses to move focus into the inert subtree
  link.focus()
  expect(document.activeElement).not.toBe(link)
  expect(figure.contains(document.activeElement)).toBe(false)

  rerender(
    <div data-testid="host" style={{ width: '358px' }}>
      <Embeds embed={embed} concealed={false} />
    </div>,
  )

  expect(figure.inert).toBe(false)
  expect(figure.getAttribute('aria-hidden')).toBeNull()
  link.focus()
  expect(document.activeElement).toBe(link)
})

it('keeps a concealed video poster out of the tab order until revealed', async () => {
  await page.viewport(390, 844)
  const { container, rerender } = renderEmbed(358, video, true)

  const figure = requireElement<HTMLElement>(container, 'figure.b-embed--video')
  const poster = requireElement<HTMLButtonElement>(container, '.b-video-player__poster')

  expect(figure.inert).toBe(true)
  expect(figure.getAttribute('aria-hidden')).toBe('true')
  poster.focus()
  expect(document.activeElement).not.toBe(poster)

  rerender(
    <div data-testid="host" style={{ width: '358px' }}>
      <Embeds embed={video} concealed={false} />
    </div>,
  )

  expect(figure.inert).toBe(false)
  expect(figure.getAttribute('aria-hidden')).toBeNull()
  poster.focus()
  expect(document.activeElement).toBe(poster)
})

it('draws one video border and the same plate on poster and paused', async () => {
  await page.viewport(1280, 800)
  hls.handlers.clear()
  const { container } = renderEmbed(600, video)

  const figure = requireElement<HTMLElement>(container, 'figure.b-embed--video')
  const player = requireElement<HTMLElement>(container, '.b-video-player')

  // the player owns the border; the embed adds none around it
  expect(getComputedStyle(figure).borderTopWidth).toBe('0px')
  expect(getComputedStyle(figure).borderLeftWidth).toBe('0px')
  expect(getComputedStyle(player).borderTopWidth).toBe('1px')
  expect(getComputedStyle(player).borderLeftWidth).toBe('1px')

  const posterPlate = requireElement<HTMLElement>(
    container,
    '.b-video-player__poster .b-video-player__plate',
  )
  const posterRect = posterPlate.getBoundingClientRect()
  expect(Math.round(posterRect.width)).toBe(64)
  expect(Math.round(posterRect.height)).toBe(64)
  expect(getComputedStyle(posterPlate).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')

  await userEvent.click(page.getByRole('button', { name: 'play video' }))
  await waitFor(() => {
    expect(hls.handlers.get('hlsManifestParsed')).toBeDefined()
  })
  act(() => {
    hls.handlers.get('hlsManifestParsed')?.('hlsManifestParsed', { fatal: false })
  })

  await waitFor(() => {
    expect(container.querySelector('.b-video-player__stage .b-video-player__plate')).not.toBeNull()
  })
  const pausedPlate = requireElement<HTMLElement>(
    container,
    '.b-video-player__stage .b-video-player__plate',
  )

  expect(pausedPlate.className).toBe(posterPlate.className)
  expect(getComputedStyle(pausedPlate).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  const pausedRect = pausedPlate.getBoundingClientRect()
  expect(Math.round(pausedRect.width)).toBe(64)
  expect(Math.round(pausedRect.height)).toBe(64)
})

it('wraps an unavailable video alt without horizontal overflow', async () => {
  await page.viewport(390, 844)
  const long = 'x'.repeat(220)
  const embed: EmbedModel = {
    type: 'video',
    thumbnail: BROKEN,
    alt: `${long}\nsecond line`,
    playlist: null,
  }
  const { container } = renderEmbed(358, embed)

  expect(container.querySelector('.b-video-player__error')?.textContent).toBe('video unavailable')

  const alt = requireElement<HTMLElement>(container, '.b-video-player__alt')
  expect(alt.textContent).toBe(`${long}\nsecond line`)
  const altStyle = getComputedStyle(alt)
  expect(altStyle.whiteSpace).toBe('pre-wrap')
  expect(altStyle.overflowWrap).toBe('anywhere')

  const altRect = alt.getBoundingClientRect()
  expect(altRect.width).toBeGreaterThan(100)
  expect(alt.scrollWidth).toBeLessThanOrEqual(Math.ceil(altRect.width) + 1)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth + 1)

  await waitFor(() => {
    expect(container.querySelectorAll('.dither-image--fallback').length).toBe(1)
  })
  const frame = requireElement<HTMLElement>(container, '.b-video-player--unavailable .dither-image')
  const frameRect = frame.getBoundingClientRect()
  expect(frameRect.width).toBeGreaterThan(100)
  expect(frameRect.height).toBeLessThanOrEqual(320 + 1)
  expect(getComputedStyle(frame).objectFit).toBe('cover')
})

it('gates only the external thumbnail while the card stays reachable', async () => {
  await page.viewport(390, 844)
  const embed: EmbedModel = {
    type: 'external',
    uri: 'https://example.test/a',
    title: 'a page',
    description: 'words about the page',
    thumb: BROKEN,
    domain: 'example.test',
  }
  const { container } = renderEmbed(358, embed, true)

  const thumb = requireElement<HTMLElement>(container, '.b-embed__thumb')
  expect(thumb.inert).toBe(true)
  expect(thumb.getAttribute('aria-hidden')).toBe('true')

  const card = requireElement<HTMLAnchorElement>(container, 'a.b-embed--external')
  expect(card.hasAttribute('inert')).toBe(false)
  expect(card.getAttribute('aria-hidden')).toBeNull()
  card.focus()
  expect(document.activeElement).toBe(card)
  expect(container.querySelector('.b-embed__external-title')?.textContent).toBe('a page')
  expect(container.querySelector('.b-embed__external-description')?.textContent).toBe(
    'words about the page',
  )
})

it('gates quote-with-media media while the quote link keeps focus', async () => {
  await page.viewport(390, 844)
  const embed: EmbedModel = {
    type: 'recordWithMedia',
    quote: quoted('quoted words'),
    media: { type: 'images', images: [brokenImage('media caption')] },
  }
  const { container } = renderEmbed(358, embed, true)

  const figure = requireElement<HTMLElement>(container, 'figure.b-embed--images')
  expect(figure.inert).toBe(true)

  const quote = requireElement<HTMLElement>(container, '.b-embed--quote')
  expect(quote.hasAttribute('inert')).toBe(false)
  quote.focus()
  expect(document.activeElement).toBe(quote)

  const open = requireElement<HTMLAnchorElement>(container, '.b-embed__quote-open')
  open.focus()
  expect(document.activeElement).toBe(open)
  expect(quote.textContent).toContain('quoted words')
})
