import { QueryClientProvider } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { PostModel, QuotedPostModel } from '../lib/types'
import { postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { renderStage } from '../test/stage'
import { PostCard } from './PostCard'

const BROKEN = 'data:image/png;base64,AAAA'

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
