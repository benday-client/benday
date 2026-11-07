import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { useSettings } from '../lib/store'
import { type MediaItem, MediaViewer } from './MediaViewer'

const BROKEN = 'data:image/png;base64,AAAA'
const FRAME = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * Chromium serializes a filter reference with quotes; the assertion is about
 * the palette the image resolves to, not the serialization.
 */
function filterOf(element: Element): string {
  return getComputedStyle(element).filter.replace(/["']/g, '')
}

/**
 * The player imports hls.js only after a poster is activated. The fake keeps
 * these real-browser cases off the network while still reaching the ready
 * state whose seek control the viewer must leave alone.
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

function brokenImage(alt: string, width: number, height: number): MediaItem {
  return {
    kind: 'image',
    // a real, unparseable image payload: the browser fires its native error
    src: BROKEN,
    alt,
    image: { thumb: BROKEN, fullsize: BROKEN, alt, width, height },
  }
}

const videoItem: MediaItem = {
  kind: 'video',
  video: {
    type: 'video',
    thumbnail: BROKEN,
    alt: 'a clip',
    playlist: 'https://example.test/clip.m3u8',
  },
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new Error(`${selector} missing`)
  return element
}

beforeEach(() => {
  hls.handlers.clear()
})

afterEach(() => {
  // the dither is the default; a case that turns it off must not leak
  act(() => {
    useSettings.getState().setImageEffects(true)
  })
})

it('keeps a failed full-size image inside the viewer cap at its declared ratio', async () => {
  const item = brokenImage('a broken full-size image', 800, 400)
  const { container } = render(<MediaViewer open items={[item]} onClose={() => {}} />)

  await waitFor(() => {
    expect(container.querySelector('.b-media-viewer__stage img')).toBeNull()
  })

  const stage = requireElement<HTMLElement>(container, '.b-media-viewer__stage')
  const fallback = requireElement<HTMLElement>(
    container,
    '.b-media-viewer__stage .dither-image--fallback',
  )

  const stageWidth = stage.getBoundingClientRect().width
  const rect = fallback.getBoundingClientRect()
  const cap = Math.min(0.72 * window.innerHeight, 680)

  // the stage really is wide, so the cap below cannot pass on a collapsed box
  expect(stageWidth).toBeGreaterThan(600)
  expect(rect.width).toBeGreaterThan(600)
  expect(rect.height).toBeLessThanOrEqual(cap + 1)
  expect(rect.height).toBeLessThan(stageWidth)

  // the declared 800x400 frame reaches the fallback: it keeps that width and
  // its 2:1 reserve instead of collapsing to the glyph line
  const expectedWidth = Math.min(800, stageWidth)
  expect(Math.abs(rect.width - expectedWidth)).toBeLessThanOrEqual(2)
  expect(Math.abs(rect.height - rect.width / 2)).toBeLessThanOrEqual(2)
})

it('announces the active alt with the count and updates it while navigating', async () => {
  const items = [brokenImage('first frame', 4, 3), brokenImage('second frame', 4, 3)]
  const { container } = render(<MediaViewer open items={items} onClose={() => {}} />)

  const count = requireElement<HTMLElement>(container, '.b-media-viewer__count')
  const alt = requireElement<HTMLElement>(container, '.b-media-viewer__alt')

  expect(count.getAttribute('aria-live')).toBe('polite')
  expect(count.textContent).toBe('1 / 2 — first frame')
  expect(alt.textContent).toBe('first frame')

  await userEvent.click(page.getByRole('button', { name: 'next image' }))

  await waitFor(() => {
    expect(count.textContent).toBe('2 / 2 — second frame')
  })
  expect(alt.textContent).toBe('second frame')
})

it('leaves Home, End and the arrows to the focused seek control', async () => {
  const items = [videoItem, brokenImage('second frame', 4, 3)]
  const { container } = render(<MediaViewer open items={items} onClose={() => {}} />)

  await userEvent.click(page.getByRole('button', { name: 'play video' }))

  const video = requireElement<HTMLVideoElement>(container, 'video')
  Object.defineProperty(video, 'duration', { value: 12, configurable: true })
  fireEvent.loadedMetadata(video)

  await waitFor(() => {
    expect(hls.handlers.get('hlsManifestParsed')).toBeDefined()
  })
  act(() => {
    hls.handlers.get('hlsManifestParsed')?.('hlsManifestParsed', { fatal: false })
  })

  const seek = requireElement<HTMLInputElement>(container, '.b-video-player__seek')
  await waitFor(() => {
    expect(seek.disabled).toBe(false)
  })
  expect(seek.max).toBe('12')

  seek.focus()
  expect(document.activeElement).toBe(seek)

  const count = requireElement<HTMLElement>(container, '.b-media-viewer__count')
  expect(count.textContent).toBe('1 / 2')

  // the range owns its native keys: the gallery index never moves
  await userEvent.keyboard('{End}')
  expect(seek.value).toBe('12')
  expect(count.textContent).toBe('1 / 2')

  await userEvent.keyboard('{Home}')
  expect(seek.value).toBe('0')
  expect(count.textContent).toBe('1 / 2')

  await userEvent.keyboard('{ArrowRight}')
  expect(seek.value).toBe('0.1')
  expect(count.textContent).toBe('1 / 2')
})

it('stops gallery digits while the character preference is off', async () => {
  useSettings.setState({ keyboardShortcuts: false })
  const onClose = vi.fn()
  const items = [
    brokenImage('first frame', 4, 3),
    brokenImage('second frame', 4, 3),
    brokenImage('third frame', 4, 3),
  ]
  const { container } = render(<MediaViewer open items={items} onClose={onClose} />)

  const count = () => container.querySelector('.b-media-viewer__count')?.textContent
  expect(count()).toBe('1 / 3 — first frame')

  await userEvent.keyboard('2')
  expect(count()).toBe('1 / 3 — first frame')

  // non-character navigation stays available
  await userEvent.keyboard('{ArrowRight}')
  expect(count()).toBe('2 / 3 — second frame')
  await userEvent.keyboard('{End}')
  expect(count()).toBe('3 / 3 — third frame')
  await userEvent.keyboard('{Home}')
  expect(count()).toBe('1 / 3 — first frame')

  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('dithers the viewer image with the active palette', () => {
  const alt = 'a full-size image'
  const item: MediaItem = {
    kind: 'image',
    src: FRAME,
    alt,
    image: { thumb: FRAME, fullsize: FRAME, alt, width: 4, height: 3 },
  }
  const { container } = render(<MediaViewer open items={[item]} onClose={() => {}} />)

  const image = requireElement<HTMLElement>(container, '.b-media-viewer__stage .dither-image')

  expect(filterOf(image)).toContain('url(#benday-dither-catppuccin-mocha)')

  document.documentElement.dataset['theme'] = 'catppuccin-latte'
  expect(filterOf(image)).toContain('url(#benday-dither-catppuccin-latte)')
  expect(filterOf(image)).not.toContain('catppuccin-mocha')
})

it('paints the viewer image plainly once the image effects setting is off', async () => {
  const alt = 'a full-size image'
  const item: MediaItem = {
    kind: 'image',
    src: FRAME,
    alt,
    image: { thumb: FRAME, fullsize: FRAME, alt, width: 4, height: 3 },
  }
  const { container } = render(<MediaViewer open items={[item]} onClose={() => {}} />)

  const image = requireElement<HTMLElement>(container, '.b-media-viewer__stage .dither-image')
  // the default setting really filters the already rendered element
  expect(image.getAttribute('data-effect')).toBeNull()
  expect(filterOf(image)).toContain('url(#benday-dither-catppuccin-mocha)')

  act(() => {
    useSettings.getState().setImageEffects(false)
  })

  await waitFor(() => {
    expect(image.getAttribute('data-effect')).toBe('none')
    expect(filterOf(image)).toBe('none')
  })
  // no palette reference of any kind survives on the same element
  expect(filterOf(image)).not.toContain('url(')
})

it('keeps the dither on a failed viewer image instead of flattening it', async () => {
  const item = brokenImage('a broken full-size image', 800, 400)
  const { container } = render(<MediaViewer open items={[item]} onClose={() => {}} />)

  const fallback = await waitFor(() => {
    const element = container.querySelector<HTMLElement>(
      '.b-media-viewer__stage .dither-image--fallback',
    )
    if (element === null) throw new Error('fallback missing')
    return element
  })

  const filter = filterOf(fallback)
  expect(filter).not.toBe('none')
  expect(filter).toContain('url(#benday-dither-catppuccin-mocha)')

  document.documentElement.dataset['theme'] = 'catppuccin-latte'
  expect(filterOf(fallback)).toContain('url(#benday-dither-catppuccin-latte)')
})

it('leaves the activated video unfiltered while its poster is dithered', async () => {
  const { container } = render(<MediaViewer open items={[videoItem]} onClose={() => {}} />)

  const poster = requireElement<HTMLElement>(container, '.b-video-player__poster .dither-image')
  expect(filterOf(poster)).toContain('url(#benday-dither-catppuccin-mocha)')

  document.documentElement.dataset['theme'] = 'catppuccin-latte'
  expect(filterOf(poster)).toContain('url(#benday-dither-catppuccin-latte)')

  await userEvent.click(page.getByRole('button', { name: 'play video' }))

  const video = await waitFor(() => {
    const element = container.querySelector<HTMLVideoElement>('video')
    if (element === null) throw new Error('video missing')
    return element
  })

  // the source frame plays as itself: the dither belongs to the poster only
  expect(getComputedStyle(video).filter).toBe('none')
  expect(container.querySelector('.b-video-player__poster')).toBeNull()
})
