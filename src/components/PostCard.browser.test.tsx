import { QueryClientProvider } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useSettings } from '../lib/store'
import type { PostModel, QuotedPostModel } from '../lib/types'
import { postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { renderStage } from '../test/stage'
import { PostCard } from './PostCard'

const BROKEN = 'data:image/png;base64,AAAA'
const FRAME = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * Chromium serializes a filter reference with quotes; the assertion is about
 * the palette the image resolves to, not the serialization.
 */
function filterOf(element: Element): string {
  return getComputedStyle(element).filter.replace(/["']/g, '')
}

const quoted: QuotedPostModel = {
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
  text: 'quoted text',
  facets: [],
  indexedAt: '2026-10-29T12:00:00.000Z',
  embedType: 'app.bsky.embed.record#view',
}

function renderCard(post: PostModel) {
  const memory = memoryLocation({ path: '/feed', record: true })
  return renderStage(
    <QueryClientProvider client={createTestQueryClient()}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <PostCard post={post} />
      </Router>
    </QueryClientProvider>,
  )
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new Error(`${selector} missing`)
  return element
}

const labelledImage = postFixture({
  labels: ['nudity'],
  embed: {
    type: 'images',
    images: [
      {
        thumb: BROKEN,
        fullsize: 'https://cdn.test/full.jpg',
        alt: 'a labelled caption',
        width: 800,
        height: 400,
      },
    ],
  },
})

afterEach(() => {
  // the dither is the default; a case that turns it off must not leak
  act(() => {
    useSettings.getState().setImageEffects(true)
  })
})

it('keeps concealed media inert and the caption blurred until reveal', async () => {
  await page.viewport(390, 844)
  const { container } = renderCard(labelledImage)

  const figure = requireElement<HTMLElement>(container, 'figure.b-embed--images')
  const caption = requireElement<HTMLElement>(container, '.b-embed__caption')
  const anchor = requireElement<HTMLAnchorElement>(container, 'a.b-embed__image-link')
  const reveal = requireElement<HTMLButtonElement>(container, '.b-spoil')

  // the figure really is inert, so chromium refuses focus inside it
  expect(figure.inert).toBe(true)
  expect(figure.getAttribute('aria-hidden')).toBe('true')
  anchor.focus()
  expect(document.activeElement).not.toBe(anchor)
  expect(figure.contains(document.activeElement)).toBe(false)

  expect(getComputedStyle(caption).userSelect).toBe('none')
  expect(getComputedStyle(caption).filter).toContain('blur')

  // the reveal control sits outside the inert subtree and can take focus
  expect(reveal.closest('[inert]')).toBeNull()
  reveal.focus()
  expect(document.activeElement).toBe(reveal)

  await userEvent.click(reveal)

  await waitFor(() => {
    expect(figure.inert).toBe(false)
  })
  expect(figure.getAttribute('aria-hidden')).toBeNull()
  await waitFor(() => expect(getComputedStyle(caption).filter).toBe('none'))

  // once revealed, the image link is interactive again
  anchor.focus()
  expect(document.activeElement).toBe(anchor)
})

it('leaves a labelled text-only quote interactive without a reveal control', async () => {
  await page.viewport(390, 844)
  const { container } = renderCard(
    postFixture({ labels: ['spoiler'], embed: { type: 'quote', post: quoted } }),
  )

  expect(container.querySelector('.b-spoil')).toBeNull()

  const quote = requireElement<HTMLElement>(container, '.b-embed--quote')
  expect(quote.inert).toBe(false)
  expect(quote.getAttribute('aria-hidden')).toBeNull()

  const open = requireElement<HTMLAnchorElement>(container, '.b-embed__quote-open')
  open.focus()
  expect(document.activeElement).toBe(open)
})

it('leaves a labelled thumbless external card focusable', async () => {
  await page.viewport(390, 844)
  const { container } = renderCard(
    postFixture({
      labels: ['spoiler'],
      embed: {
        type: 'external',
        uri: 'https://example.test/a',
        title: 'a page',
        description: 'words about the page',
        thumb: null,
        domain: 'example.test',
      },
    }),
  )

  expect(container.querySelector('.b-spoil')).toBeNull()
  const card = requireElement<HTMLAnchorElement>(container, 'a.b-embed--external')
  expect(card.inert).toBe(false)
  card.focus()
  expect(document.activeElement).toBe(card)
})

it('dithers a rendered post image with the active palette', () => {
  const { container } = renderCard(
    postFixture({
      embed: {
        type: 'images',
        images: [
          {
            thumb: FRAME,
            fullsize: 'https://cdn.test/full.gif',
            alt: 'a rendered caption',
            width: 4,
            height: 3,
          },
        ],
      },
    }),
  )

  const image = requireElement<HTMLElement>(container, '.b-embed__image-frame .dither-image')

  expect(filterOf(image)).toContain('url(#benday-dither-catppuccin-mocha)')

  document.documentElement.dataset['theme'] = 'catppuccin-latte'
  expect(filterOf(image)).toContain('url(#benday-dither-catppuccin-latte)')
  expect(filterOf(image)).not.toContain('catppuccin-mocha')
})

it('paints the post image plainly once the image effects setting is off', async () => {
  const { container } = renderCard(
    postFixture({
      embed: {
        type: 'images',
        images: [
          {
            thumb: FRAME,
            fullsize: 'https://cdn.test/full.gif',
            alt: 'a rendered caption',
            width: 4,
            height: 3,
          },
        ],
      },
    }),
  )

  const image = requireElement<HTMLElement>(container, '.b-embed__image-frame .dither-image')
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

it('keeps the dither on a failed post image instead of flattening it', async () => {
  const { container } = renderCard(
    postFixture({
      embed: {
        type: 'images',
        images: [
          {
            thumb: BROKEN,
            fullsize: 'https://cdn.test/full.jpg',
            alt: 'a broken caption',
            width: 800,
            height: 400,
          },
        ],
      },
    }),
  )

  const fallback = await waitFor(() => {
    const element = container.querySelector<HTMLElement>(
      '.b-embed__image-frame .dither-image--fallback',
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

it('paints no texture or cursor token and no body overlay over the card', () => {
  const { container } = renderCard(postFixture())

  // an undeclared token computes empty even where the card inherits the theme
  const card = getComputedStyle(requireElement<HTMLElement>(container, '.b-post-card'))
  expect(card.getPropertyValue('--surface-texture').trim()).toBe('')
  expect(card.getPropertyValue('--cursor-default').trim()).toBe('')

  // the shell layers no noise pseudo-element over the deck
  expect(getComputedStyle(document.body, '::before').content).toBe('none')
})
