import type { Query, QueryKey } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { displayedCount, useActionStore } from '../lib/actionStore'
import { deletePost, type FeedFeedbackEvent, fetchViewerStates, likePost } from '../lib/actions'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import type { PostModel } from '../lib/types'
import { useUiStore } from '../lib/ui'
import { postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { HOLD_PAINT_MS, HOLD_THRESHOLD_MS, KeyHints } from './KeyHints'
import { PostCard } from './PostCard'

vi.mock('../lib/actions', () => ({
  createPost: vi.fn(),
  createReply: vi.fn(),
  createQuote: vi.fn(),
  deletePost: vi.fn(),
  fetchViewerStates: vi.fn(async () => new Map()),
  likePost: vi.fn(),
  unlikePost: vi.fn(),
  repostPost: vi.fn(),
  unrepostPost: vi.fn(),
  sendFeedFeedback: vi.fn(),
}))

function quoteFixture() {
  return {
    uri: 'at://did:plc:test/app.bsky.feed.post/quoted',
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
}

describe('displayedCount', () => {
  it('applies the optimistic delta while the post count matches the base', () => {
    expect(displayedCount(10, 10, 1)).toBe(11)
    expect(displayedCount(10, 10, -1)).toBe(9)
  })

  it('trusts a refreshed post count over a stale delta', () => {
    expect(displayedCount(12, 10, 1)).toBe(12)
    expect(displayedCount(8, 10, -1)).toBe(8)
  })

  it('uses the post count when there is no optimistic base', () => {
    expect(displayedCount(7, null, 0)).toBe(7)
  })
})

describe('PostCard click', () => {
  const renderCard = (onOpen?: () => void) =>
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <PostCard post={postFixture()} {...(onOpen === undefined ? {} : { onOpen })} />
        </Router>
      </QueryClientProvider>,
    )

  it('opens the post from a plain click but not from an inner control', () => {
    const onOpen = vi.fn()
    const { container } = renderCard(onOpen)
    const card = container.querySelector('article')
    if (card === null) throw new Error('card missing')

    fireEvent.click(card)
    expect(onOpen).toHaveBeenCalledTimes(1)

    const link = card.querySelector('a')
    if (link === null) throw new Error('link missing')
    fireEvent.click(link)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('opens from a body click inside a focusable deck item', () => {
    const onOpen = vi.fn()
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <ul>
            <li tabIndex={-1}>
              <PostCard post={postFixture()} onOpen={onOpen} />
            </li>
          </ul>
        </Router>
      </QueryClientProvider>,
    )
    const body = document.querySelector('.b-post-card__body')
    if (body === null) throw new Error('body missing')
    fireEvent.click(body)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('stays inert without an open handler', () => {
    const { container } = renderCard()
    const card = container.querySelector('article')
    expect(card?.getAttribute('data-clickable')).toBeNull()
  })
})

describe('PostCard click targets', () => {
  it('leaves footer actions and media to their own handlers', () => {
    const onOpen = vi.fn()
    const { container } = render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <PostCard
            post={postFixture({
              embed: {
                type: 'images',
                images: [{ thumb: 't', fullsize: 'f', alt: 'a', width: 4, height: 3 }],
              },
            })}
            onOpen={onOpen}
          />
        </Router>
      </QueryClientProvider>,
    )
    const card = container.querySelector('article')
    if (card === null) throw new Error('card missing')

    const media = card.querySelector('.b-post-card__media')
    if (media === null) throw new Error('media missing')
    fireEvent.click(media)
    expect(onOpen).not.toHaveBeenCalled()

    const action = card.querySelector('.b-post-card__action')
    if (action === null) throw new Error('action missing')
    fireEvent.click(action)
    expect(onOpen).not.toHaveBeenCalled()

    const text = card.querySelector('.b-post-card__text') ?? card.querySelector('.b-frame__body')
    if (text === null) throw new Error('body missing')
    fireEvent.click(text)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('PostCard layout', () => {
  it('keeps the index and reply tag in the meta row and the timestamp in the author row', () => {
    // two hours old sits well inside the hour band, so the relative text is stable
    const indexedAt = new Date(Date.now() - (2 * 60 + 5) * 60_000).toISOString()
    const { container } = render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <PostCard post={postFixture({ indexedAt, isReply: true })} index={3} />
        </Router>
      </QueryClientProvider>,
    )

    const article = container.querySelector('article')
    if (article === null) throw new Error('card missing')
    expect(article.querySelector('header')).toBeNull()

    const meta = article.querySelector<HTMLElement>('.b-post-card__meta')
    if (meta === null) throw new Error('meta row missing')
    expect(within(meta).getByText('[03]')).toBeInTheDocument()
    expect(within(meta).getByText('reply')).toBeInTheDocument()

    const authorRow = article.querySelector<HTMLElement>('.b-post-card__author')
    if (authorRow === null) throw new Error('author row missing')
    const timestamp = within(authorRow).getByText('2h')
    expect(timestamp).toHaveAttribute('datetime', indexedAt)
    // the timestamp cell is a direct child of the author row, never the meta band
    expect(timestamp.parentElement?.parentElement).toBe(authorRow)
    expect(meta.contains(timestamp)).toBe(false)
    expect(timestamp.closest('header')).toBeNull()
  })
})

describe('PostCard labels', () => {
  const renderCard = (post: PostModel) =>
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <PostCard post={post} />
        </Router>
      </QueryClientProvider>,
    )

  const mediaPost = (labels: string[]) =>
    postFixture({
      labels,
      embed: {
        type: 'images',
        images: [{ thumb: 't', fullsize: 'f', alt: 'a', width: 4, height: 3 }],
      },
    })

  it('blurs labelled media until the reader asks for it', () => {
    const { container } = renderCard(mediaPost(['twitter-screenshot']))
    expect(container.querySelector('.b-post-card__media')?.getAttribute('data-spoil')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: /show image/ }))

    expect(container.querySelector('.b-post-card__media')?.getAttribute('data-spoil')).toBeNull()
    expect(screen.queryByRole('button', { name: /show image/ })).not.toBeInTheDocument()
  })

  it('leaves unlabelled media open', () => {
    const { container } = renderCard(mediaPost([]))
    expect(container.querySelector('.b-post-card__media')?.getAttribute('data-spoil')).toBeNull()
    expect(screen.queryByRole('button', { name: /show image/ })).not.toBeInTheDocument()
  })

  it('reveals labelled media without activating the image link', () => {
    const { container } = renderCard(
      postFixture({
        labels: ['twitter-screenshot'],
        embed: {
          type: 'images',
          images: [
            {
              thumb: 'https://cdn.test/thumb.jpg',
              fullsize: 'https://cdn.test/full.jpg',
              alt: 'screenshot',
              width: 4,
              height: 3,
            },
          ],
        },
      }),
    )

    const media = container.querySelector('.b-post-card__media')
    const button = screen.getByRole('button', { name: /show image/ })
    const anchor = container.querySelector('a.b-embed__image-link')

    expect(button.closest('a')).toBeNull()
    expect(media?.getAttribute('data-spoil')).toBe('true')
    expect(anchor).not.toBeNull()
    expect(anchor?.getAttribute('href')).toBe('https://cdn.test/full.jpg')

    const anchorClick = vi.fn()
    anchor?.addEventListener('click', anchorClick)

    fireEvent.click(button)

    expect(media?.getAttribute('data-spoil')).toBeNull()
    expect(screen.queryByRole('button', { name: /show image/ })).not.toBeInTheDocument()
    expect(anchorClick).not.toHaveBeenCalled()

    const revealedAnchor = container.querySelector('a.b-embed__image-link')
    if (revealedAnchor === null) throw new Error('anchor missing after reveal')
    fireEvent.click(revealedAnchor)
    expect(anchorClick).toHaveBeenCalledTimes(1)
  })

  it('makes concealed media inert and hidden while the reveal stays live', () => {
    const { container } = renderCard(mediaPost(['nudity']))
    const figure = container.querySelector('figure.b-embed--images')
    const button = screen.getByRole('button', { name: /show image/ })

    expect(figure?.hasAttribute('inert')).toBe(true)
    expect(figure?.getAttribute('aria-hidden')).toBe('true')
    // the reveal control must not sit inside the inert subtree
    expect(button.closest('[inert]')).toBeNull()

    fireEvent.click(button)

    expect(figure?.hasAttribute('inert')).toBe(false)
    expect(figure?.getAttribute('aria-hidden')).toBeNull()
  })

  it('never offers a reveal for a labelled text-only quote', () => {
    const { container } = renderCard(
      postFixture({ labels: ['spoiler'], embed: { type: 'quote', post: quoteFixture() } }),
    )

    expect(screen.queryByRole('button', { name: /^show / })).not.toBeInTheDocument()
    expect(container.querySelector('.b-post-card__media')?.getAttribute('data-spoil')).toBeNull()
    const quote = container.querySelector('.b-embed--quote')
    expect(quote?.hasAttribute('inert')).toBe(false)
    expect(quote?.getAttribute('aria-hidden')).toBeNull()
    expect(screen.getByText('quoted text')).toBeInTheDocument()
  })

  it('leaves a labelled external card without a thumbnail live', () => {
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

    expect(screen.queryByRole('button', { name: /^show / })).not.toBeInTheDocument()
    const card = container.querySelector('a.b-embed--external')
    expect(card?.hasAttribute('inert')).toBe(false)
    expect(screen.getByText('words about the page')).toBeInTheDocument()
  })

  it('conceals only the external thumbnail and keeps its text live', () => {
    const { container } = renderCard(
      postFixture({
        labels: ['spoiler'],
        embed: {
          type: 'external',
          uri: 'https://example.test/b',
          title: 'another page',
          description: 'more words',
          thumb: 'https://cdn.test/thumb.jpg',
          domain: 'example.test',
        },
      }),
    )

    const thumb = container.querySelector('.b-embed__thumb')
    expect(thumb?.hasAttribute('inert')).toBe(true)
    expect(thumb?.getAttribute('aria-hidden')).toBe('true')
    const link = container.querySelector('a.b-embed--external')
    expect(link?.hasAttribute('inert')).toBe(false)
    expect(screen.getByText('another page')).toBeInTheDocument()
    expect(screen.getByText('more words')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show media/ })).toBeInTheDocument()
  })

  it('conceals record media while the quote text stays live', () => {
    const { container } = renderCard(
      postFixture({
        labels: ['nudity'],
        embed: {
          type: 'recordWithMedia',
          quote: quoteFixture(),
          media: {
            type: 'images',
            images: [{ thumb: 't', fullsize: 'f', alt: 'a', width: 4, height: 3 }],
          },
        },
      }),
    )

    expect(container.querySelector('figure.b-embed--images')?.hasAttribute('inert')).toBe(true)
    expect(container.querySelector('.b-embed--quote')?.hasAttribute('inert')).toBe(false)
    expect(screen.getByText('quoted text')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show image/ })).toBeInTheDocument()
  })
})

describe('PostCard labelled media keys', () => {
  const renderFocused = (post: PostModel) =>
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <PostCard post={post} focused />
        </Router>
      </QueryClientProvider>,
    )

  it('keeps the media keys inert until the labelled media is revealed', () => {
    renderFocused(
      postFixture({
        labels: ['nudity'],
        embed: {
          type: 'video',
          thumbnail: null,
          alt: 'test clip',
          playlist: 'https://example.test/video.m3u8',
        },
      }),
    )

    expect(document.querySelector('.b-video-player__poster')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'v' })
    expect(document.querySelector('.b-video-player__poster')).not.toBeNull()
    expect(document.querySelector('.b-video-player__video')).toBeNull()

    fireEvent.keyDown(window, { key: 'm' })
    expect(document.querySelector('dialog.b-media-viewer')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /show video/ }))

    fireEvent.keyDown(window, { key: 'v' })
    expect(document.querySelector('.b-video-player__video')).not.toBeNull()

    fireEvent.keyDown(window, { key: 'm' })
    expect(document.querySelector('dialog.b-media-viewer')).not.toBeNull()
  })

  it('reveals labelled media with x, then the media keys work', () => {
    renderFocused(
      postFixture({
        labels: ['nudity'],
        embed: {
          type: 'video',
          thumbnail: null,
          alt: 'test clip',
          playlist: 'https://example.test/video.m3u8',
        },
      }),
    )

    expect(document.querySelector('.b-video-player__poster')).not.toBeNull()
    expect(screen.getByRole('button', { name: /show video/ })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'v' })
    expect(document.querySelector('.b-video-player__video')).toBeNull()
    fireEvent.keyDown(window, { key: 'm' })
    expect(document.querySelector('dialog.b-media-viewer')).toBeNull()

    fireEvent.keyDown(window, { key: 'x' })
    expect(screen.queryByRole('button', { name: /show video/ })).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'v' })
    expect(document.querySelector('.b-video-player__video')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'm' })
    expect(document.querySelector('dialog.b-media-viewer')).not.toBeNull()
  })
})

describe('PostCard avatar', () => {
  const renderAuthor = (author: Partial<PostModel['author']>) =>
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <PostCard
            post={postFixture({
              author: {
                did: 'did:plc:test',
                handle: 'test.bsky.social',
                displayName: 'test',
                avatar: null,
                muted: false,
                blocked: false,
                ...author,
              },
            })}
          />
        </Router>
      </QueryClientProvider>,
    )

  it('shows one whole emoji from the display name', () => {
    const { container } = renderAuthor({ displayName: '🚀 pilot' })
    expect(
      container.querySelector('.b-post-card__avatar .dither-image--fallback')?.textContent,
    ).toBe('🚀')
  })

  it('falls back to the handle initial when the display name is empty', () => {
    const { container } = renderAuthor({ displayName: '' })
    expect(
      container.querySelector('.b-post-card__avatar .dither-image--fallback')?.textContent,
    ).toBe('T')
  })
})

describe('PostCard actions', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(deletePost).mockReset()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  beforeEach(() => {
    useAuthStore.setState({
      status: 'anonymous',
      account: null,
      pending: false,
      error: null,
    })
    useUiStore.setState({ dialog: null, compose: null, inlineCompose: null })
    useActionStore.getState().reset()
  })

  it('shows its feed position only when given an index', () => {
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} index={3} />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.getByText('[03]')).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('[03]')).not.toBeInTheDocument()
  })

  it('dismisses only once the operator accepts a less feedback', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const gate = Promise.withResolvers<void>()
    const feedback = vi.fn((_post: PostModel, _event: FeedFeedbackEvent) => gate.promise)
    const dismiss = vi.fn()
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused onFeedback={feedback} onDismiss={dismiss} />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'less like this' }))
    expect(feedback.mock.calls[0]?.[1]).toBe('less')
    expect(dismiss).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await act(async () => {
      gate.resolve()
    })
    await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1))
  })

  it('sends one interaction from the focused card keys and claims success after it lands', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const gate = Promise.withResolvers<void>()
    const feedback = vi.fn((_post: PostModel, _event: FeedFeedbackEvent) => gate.promise)
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused onFeedback={feedback} />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('button', { name: 'more like this' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '+' })
    fireEvent.keyDown(window, { key: '+' })

    expect(feedback).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await act(async () => {
      gate.resolve()
    })

    expect(screen.getByRole('status')).toHaveTextContent('feedback sent to the feed operator')
    expect(screen.queryByRole('button', { name: 'more like this' })).not.toBeInTheDocument()
  })

  it('reports a failed feedback and keeps the post visible', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const feedback = vi.fn((_post: PostModel, _event: FeedFeedbackEvent) =>
      Promise.reject(new Error('operator refused')),
    )
    const dismiss = vi.fn()
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused onFeedback={feedback} onDismiss={dismiss} />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'less like this' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('operator refused')
    expect(dismiss).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'more like this' })).toBeEnabled()
  })

  it('copies a bsky.app link from the focused-card shortcut', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.keyDown(window, { key: 'y' })

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://bsky.app/profile/test.bsky.social/post/1')
    })
    expect(screen.getByRole('button', { name: 'copied' })).toBeInTheDocument()
  })

  it('copies a bsky.app link from a signed-out focused card', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('button', { name: 'copy link' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'y' })

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://bsky.app/profile/test.bsky.social/post/1')
    })
    expect(screen.getByRole('button', { name: 'copied' })).toBeInTheDocument()
  })

  it('activates the focused post video with the v key', () => {
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    const post = postFixture({
      embed: {
        type: 'video',
        thumbnail: null,
        alt: 'test clip',
        playlist: 'https://example.test/video.m3u8',
      },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={post} focused />
        </Router>
      </QueryClientProvider>,
    )

    expect(document.querySelector('.b-video-player__poster')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'v' })
    expect(document.querySelector('.b-video-player__poster')).toBeNull()
    expect(document.querySelector('.b-video-player__video')).not.toBeNull()
  })

  it('opens a quoted post with the 0 key and a link', () => {
    const location = memoryLocation({ path: '/', record: true })
    const queryClient = createTestQueryClient()
    const quoted = {
      uri: 'at://did:plc:test/app.bsky.feed.post/quoted',
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
    const post = postFixture({ embed: { type: 'quote', post: quoted } })

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={post} focused />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('record')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open quoted post/ })).toHaveAttribute(
      'href',
      `/thread?uri=${encodeURIComponent(quoted.uri)}`,
    )
    fireEvent.keyDown(window, { key: '0' })
    expect(location.history.at(-1)).toBe(`/thread?uri=${encodeURIComponent(quoted.uri)}`)
  })

  it('opens a quoted post with o and keeps 0 as an alias', () => {
    const location = memoryLocation({ path: '/', record: true })
    const queryClient = createTestQueryClient()
    const quoted = quoteFixture()

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture({ embed: { type: 'quote', post: quoted } })} focused />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.keyDown(window, { key: 'o' })
    expect(location.history.at(-1)).toBe(`/thread?uri=${encodeURIComponent(quoted.uri)}`)
    fireEvent.keyDown(window, { key: '0' })
    expect(location.history.at(-1)).toBe(`/thread?uri=${encodeURIComponent(quoted.uri)}`)
  })

  it('leaves o inert when the focused post has no quote', () => {
    const location = memoryLocation({ path: '/', record: true })
    const queryClient = createTestQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.keyDown(window, { key: 'o' })

    expect(location.history).toEqual(['/'])
  })

  it('ignores composing keydowns', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const location = memoryLocation({ path: '/', record: true })
    const queryClient = createTestQueryClient()
    const quoted = quoteFixture()

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture({ embed: { type: 'quote', post: quoted } })} focused />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.keyDown(window, { key: 'o', isComposing: true })
    fireEvent.keyDown(window, { key: 'd', isComposing: true })

    expect(location.history).toEqual(['/'])
    expect(screen.queryByRole('button', { name: 'confirm delete' })).not.toBeInTheDocument()
  })

  it('opens a quoted post when the quote card is clicked', () => {
    const location = memoryLocation({ path: '/', record: true })
    const queryClient = createTestQueryClient()
    const quoted = {
      uri: 'at://did:plc:test/app.bsky.feed.post/quoted',
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

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture({ embed: { type: 'quote', post: quoted } })} />
        </Router>
      </QueryClientProvider>,
    )

    const quote = document.querySelector('.b-embed--quote')
    expect(quote).not.toBeNull()
    const authorLink = screen.getByRole('link', { name: 'quoted' })
    expect(authorLink).toHaveAttribute('href', '/profile/quoted.test')
    fireEvent.click(authorLink)
    expect(location.history.at(-1)).toBe('/profile/quoted.test')
    fireEvent.click(quote as Element)
    expect(location.history.at(-1)).toBe(`/thread?uri=${encodeURIComponent(quoted.uri)}`)
  })

  it('opens a quoted post with 0 even when the post owns a reply list', () => {
    const location = memoryLocation({ path: '/', record: true })
    const queryClient = createTestQueryClient()
    const quoted = {
      uri: 'at://did:plc:test/app.bsky.feed.post/quoted',
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

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard
            post={postFixture({ embed: { type: 'quote', post: quoted } })}
            focused
            replies={<div>reply list</div>}
          />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.keyDown(window, { key: '0' })
    expect(location.history.at(-1)).toBe(`/thread?uri=${encodeURIComponent(quoted.uri)}`)
  })

  it('opens the reply composer when a signed-in user replies', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const post = postFixture()
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={post} />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'reply' }))
    expect(useUiStore.getState().compose).toEqual({ mode: 'reply', post })
  })

  it('opens the reply composer from the focused-card reply shortcut', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const post = postFixture()
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={post} focused />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.keyDown(window, { key: 'r' })
    expect(useUiStore.getState().compose).toEqual({ mode: 'reply', post })
  })

  it('keeps a shortcut while a control inside the card has focus', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const post = postFixture()
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={post} focused />
        </Router>
      </QueryClientProvider>,
    )

    const replyButton = screen.getByRole('button', { name: 'reply' })
    act(() => replyButton.focus())
    fireEvent.keyDown(replyButton, { key: 'r' })

    // an in-card control keeps its own activation, and the card still answers
    expect(useUiStore.getState().compose).toEqual({ mode: 'reply', post })
  })

  it('leaves its shortcuts to an interactive control outside the card', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <div>
            <button type="button">topbar action</button>
            <PostCard post={postFixture()} focused />
          </div>
        </Router>
      </QueryClientProvider>,
    )

    const outside = screen.getByRole('button', { name: 'topbar action' })
    act(() => outside.focus())
    fireEvent.keyDown(outside, { key: 'r' })

    // the card never answers a shortcut aimed at an unrelated control
    expect(useUiStore.getState().compose).toBeNull()
  })

  it('arms deletion from the focused-card shortcut without deleting', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.keyDown(window, { key: 'd' })
    expect(screen.getByRole('button', { name: 'confirm delete' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('delete armed, press again to confirm')
    expect(deletePost).not.toHaveBeenCalled()
  })

  it('renders no parent preview on an ordinary list card', () => {
    const post = postFixture({
      replyContext: {
        uri: 'at://did:plc:parent/app.bsky.feed.post/1',
        cid: 'parent-cid',
        author: {
          did: 'did:plc:parent',
          handle: 'parent.bsky.social',
          displayName: 'parent',
          avatar: null,
          muted: false,
          blocked: false,
        },
        text: 'the post being answered',
        facets: [],
        indexedAt: '2026-10-29T12:00:00.000Z',
      },
    })
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={post} />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('replying to')).toBeNull()
    expect(screen.queryByText('the post being answered')).toBeNull()
  })

  it('does not offer deletion when the post uri belongs to another repo', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const post = postFixture({ uri: 'at://did:plc:other/app.bsky.feed.post/1' })
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={post} focused />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('button', { name: 'delete' })).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'd' })
    expect(screen.queryByRole('button', { name: 'confirm delete' })).not.toBeInTheDocument()
  })

  it('clears an armed delete confirmation when the card switches posts', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture({ uri: 'at://did:plc:test/app.bsky.feed.post/1' })} focused />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.keyDown(window, { key: 'd' })
    expect(screen.getByRole('button', { name: 'confirm delete' })).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture({ uri: 'at://did:plc:test/app.bsky.feed.post/2' })} focused />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('button', { name: 'confirm delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'delete' })).toBeInTheDocument()
  })

  const renderOwnFocused = () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const location = memoryLocation({ path: '/', record: true })
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused />
        </Router>
      </QueryClientProvider>,
    )
    return location
  }

  it('confirms an armed delete with enter and leaves a deleted result', async () => {
    vi.mocked(deletePost).mockResolvedValue(undefined)
    renderOwnFocused()

    fireEvent.keyDown(window, { key: 'd' })
    expect(screen.getByRole('button', { name: 'confirm delete' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Enter' })

    await waitFor(() =>
      expect(deletePost).toHaveBeenCalledWith('at://did:plc:test/app.bsky.feed.post/1'),
    )
    expect(await screen.findByText('post deleted')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'confirm delete' })).not.toBeInTheDocument()
    // the copy affordance survives the deleted result
    expect(screen.getByRole('button', { name: 'copy link' })).toBeInTheDocument()
  })

  it('confirms an armed delete with a second d', async () => {
    vi.mocked(deletePost).mockResolvedValue(undefined)
    renderOwnFocused()

    fireEvent.keyDown(window, { key: 'd' })
    fireEvent.keyDown(window, { key: 'd' })

    await waitFor(() => expect(deletePost).toHaveBeenCalledTimes(1))
  })

  it('leaves a deleted result that opens nothing and refetches no feed', async () => {
    vi.mocked(deletePost).mockResolvedValue(undefined)
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const queryClient = createTestQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const onOpen = vi.fn()
    const location = memoryLocation({ path: '/', record: true })
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused onOpen={onOpen} />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.keyDown(window, { key: 'd' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(await screen.findByText('post deleted')).toBeInTheDocument()

    for (const name of ['like, 2', 'repost, 1', 'reply', 'quote', 'delete']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }

    const article = document.querySelector('article')
    if (article === null) throw new Error('card missing')
    expect(article.getAttribute('data-clickable')).toBeNull()
    fireEvent.click(article)
    expect(onOpen).not.toHaveBeenCalled()

    // no mutating shortcut or re-arm survives the deleted result
    fireEvent.keyDown(window, { key: 'f' })
    fireEvent.keyDown(window, { key: 'd' })
    expect(screen.queryByRole('button', { name: 'confirm delete' })).not.toBeInTheDocument()

    // the write invalidates non-feed data only, so the feed keeps its pages
    expect(invalidate).toHaveBeenCalled()
    const invalidateFilter = invalidate.mock.calls[0]?.[0]
    const predicate = invalidateFilter?.predicate
    if (predicate === undefined) throw new Error('delete must filter its invalidation')
    const queryFor = (queryKey: QueryKey): Query =>
      queryClient.getQueryCache().build(queryClient, { queryKey })
    expect(predicate(queryFor(['feed', 'home']))).toBe(false)
    expect(predicate(queryFor(['thread', 'at://x']))).toBe(true)
  })

  it('disarms a delete after four seconds', () => {
    vi.useFakeTimers()
    renderOwnFocused()

    fireEvent.keyDown(window, { key: 'd' })
    expect(screen.getByRole('button', { name: 'confirm delete' })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(4000)
    })

    expect(screen.queryByRole('button', { name: 'confirm delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'delete' })).toBeInTheDocument()
    expect(deletePost).not.toHaveBeenCalled()
  })

  it('keeps the primary delete node and lets cancel clear the old arm timer', () => {
    vi.useFakeTimers()
    renderOwnFocused()

    const primary = screen.getByRole('button', { name: 'delete' })
    fireEvent.keyDown(window, { key: 'd' })
    // arming changes the label on the same control, it does not swap nodes
    expect(screen.getByRole('button', { name: 'confirm delete' })).toBe(primary)

    act(() => {
      vi.advanceTimersByTime(3900)
    })

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))
    // cancelling disarms and returns focus to the primary control
    expect(screen.getByRole('button', { name: 'delete' })).toBe(primary)
    expect(primary).toHaveFocus()

    // a pointer arm after cancel must not inherit the stale 4000ms deadline
    fireEvent.click(primary)
    expect(screen.getByRole('button', { name: 'confirm delete' })).toBe(primary)

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByRole('button', { name: 'confirm delete' })).toBe(primary)
    expect(deletePost).not.toHaveBeenCalled()
  })

  it('hands focus to the owning deck before the confirm control is disabled', () => {
    vi.mocked(deletePost).mockReturnValue(new Promise<void>(() => {}))
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const location = memoryLocation({ path: '/', record: true })
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={location.hook}>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the deck scroller is the tab stop in this production-shaped stand-in */}
          <ol className="b-deck" tabIndex={0} aria-label="test deck">
            <li data-deck-index="0">
              <PostCard post={postFixture()} focused />
            </li>
          </ol>
        </Router>
      </QueryClientProvider>,
    )

    const deck = screen.getByRole('list', { name: 'test deck' })
    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    const confirm = screen.getByRole('button', { name: 'confirm delete' })
    confirm.focus()
    expect(confirm).toHaveFocus()

    fireEvent.click(confirm)

    // the deck owns focus before the button becomes unfocusable
    expect(deck).toHaveFocus()
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAttribute('aria-busy', 'true')
  })

  it('hands focus to the deck when a like disables its own control', () => {
    vi.mocked(likePost).mockReturnValue(new Promise<never>(() => {}))
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const location = memoryLocation({ path: '/', record: true })
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={location.hook}>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the deck scroller is the tab stop in this production-shaped stand-in */}
          <ol className="b-deck" tabIndex={0} aria-label="test deck">
            <li data-deck-index="0">
              <PostCard post={postFixture()} focused />
            </li>
          </ol>
        </Router>
      </QueryClientProvider>,
    )

    const deck = screen.getByRole('list', { name: 'test deck' })
    const like = screen.getByRole('button', { name: 'like, 2' })
    like.focus()
    fireEvent.click(like)

    expect(deck).toHaveFocus()
  })

  it('cancels an armed delete with escape without leaving the view', () => {
    const location = renderOwnFocused()

    fireEvent.keyDown(window, { key: 'd' })
    expect(screen.getByRole('button', { name: 'confirm delete' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('button', { name: 'confirm delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'delete' })).toBeInTheDocument()
    expect(location.history).toEqual(['/'])
    expect(deletePost).not.toHaveBeenCalled()
  })

  it('drops the optimistic delta once the post count is refreshed', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const post = postFixture({ likeCount: 2, repostCount: 1 })
    useActionStore.setState({
      byUri: {
        [post.uri]: {
          likeUri: 'at://like/1',
          repostUri: null,
          likeDelta: 1,
          repostDelta: 0,
          likeBaseCount: 2,
          repostBaseCount: null,
          pending: null,
          error: null,
          likeCheckedAt: 1_000,
          repostCheckedAt: 1_000,
          likeWrittenAt: null,
          repostWrittenAt: null,
        },
      },
    })
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={post} />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('button', { name: 'like, 3' })).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={{ ...post, likeCount: 5 }} />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('button', { name: 'like, 5' })).toBeInTheDocument()
  })

  it('shows the action failure and allows another attempt', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const post = postFixture({ likeCount: 2 })
    vi.mocked(fetchViewerStates).mockResolvedValue(
      new Map([[post.uri, { likeUri: null, repostUri: null }]]),
    )
    vi.mocked(likePost).mockRejectedValueOnce(new Error('like refused'))

    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={post} />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'like, 2' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('like refused')
    expect(screen.getByRole('button', { name: 'like, 2' })).toBeEnabled()

    vi.mocked(likePost).mockResolvedValue({ uri: 'at://like/1', cid: 'like-cid' })
    fireEvent.click(screen.getByRole('button', { name: 'like, 2' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'like, 3' })).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('PostCard shortcut opt-out', () => {
  afterEach(() => {
    useSettings.setState({ keyboardShortcuts: true })
    vi.mocked(fetchViewerStates).mockReset()
    vi.mocked(fetchViewerStates).mockResolvedValue(new Map())
    vi.mocked(likePost).mockReset()
  })

  function renderFocusedCard(post: PostModel) {
    const location = memoryLocation({ path: '/', record: true })
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={post} focused />
        </Router>
      </QueryClientProvider>,
    )
    return location
  }

  function signIn(): void {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    useUiStore.setState({ dialog: null, compose: null, inlineCompose: null })
    useActionStore.getState().reset()
  }

  it('leaves the card letters inert while the character shortcuts are off', async () => {
    useSettings.setState({ keyboardShortcuts: false })
    signIn()
    const post = postFixture({
      labels: ['nudity'],
      embed: {
        type: 'video',
        thumbnail: null,
        alt: 'test clip',
        playlist: 'https://example.test/video.m3u8',
      },
    })
    vi.mocked(fetchViewerStates).mockResolvedValue(
      new Map([[post.uri, { likeUri: null, repostUri: null }]]),
    )
    vi.mocked(likePost).mockResolvedValue({ uri: 'at://like/1', cid: 'like-cid' })
    const location = renderFocusedCard(post)

    for (const key of ['f', 'x', 'v', 'm', 'd', '+', 'y']) {
      fireEvent.keyDown(window, { key })
    }

    expect(likePost).not.toHaveBeenCalled()
    expect(useUiStore.getState().dialog).toBeNull()
    expect(screen.queryByRole('button', { name: 'confirm delete' })).not.toBeInTheDocument()
    expect(document.querySelector('.b-video-player__video')).toBeNull()
    expect(document.querySelector('dialog.b-media-viewer')).toBeNull()
    // labelled media is still blurred: x never revealed it
    expect(screen.getByRole('button', { name: /show video/ })).toBeInTheDocument()
    expect(location.history).toEqual(['/'])

    // the guard reads live settings, so the same mount resumes on the setting
    useSettings.setState({ keyboardShortcuts: true })
    fireEvent.keyDown(window, { key: 'x' })
    expect(screen.queryByRole('button', { name: /show video/ })).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'f' })
    await waitFor(() => expect(likePost).toHaveBeenCalledTimes(1))
  })

  it('leaves the quoted-post keys inert while the character shortcuts are off', () => {
    useSettings.setState({ keyboardShortcuts: false })
    signIn()
    const quoted = quoteFixture()
    const location = renderFocusedCard(postFixture({ embed: { type: 'quote', post: quoted } }))

    fireEvent.keyDown(window, { key: 'o' })
    fireEvent.keyDown(window, { key: '0' })
    expect(location.history).toEqual(['/'])

    useSettings.setState({ keyboardShortcuts: true })
    fireEvent.keyDown(window, { key: 'o' })
    expect(location.history.at(-1)).toBe(`/thread?uri=${encodeURIComponent(quoted.uri)}`)
  })
})

describe('PostCard video controls', () => {
  function renderFocusedVideo(embed: PostModel['embed']) {
    const queryClient = createTestQueryClient()
    return render(
      <QueryClientProvider client={queryClient}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <PostCard post={postFixture({ embed })} focused />
          <KeyHints route="/feed" />
        </Router>
      </QueryClientProvider>,
    )
  }

  it('never activates or teaches the video key without a playlist', () => {
    vi.useFakeTimers()
    try {
      renderFocusedVideo({ type: 'video', thumbnail: null, alt: 'clip', playlist: null })

      fireEvent.keyDown(window, { key: 'v' })
      expect(document.querySelector('.b-video-player__poster')).toBeNull()
      expect(document.querySelector('.b-video-player__video')).toBeNull()

      fireEvent.keyDown(window, { key: '?' })
      act(() => {
        vi.advanceTimersByTime(HOLD_THRESHOLD_MS + HOLD_PAINT_MS + 20)
      })
      const labels = Array.from(document.querySelectorAll('.b-keyhint')).map(
        (node) => node.textContent,
      )
      expect(labels).toContain('m')
      // a key that is refused must not advertise itself
      expect(labels).not.toContain('v')
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves a quoted video without a playlist inert', () => {
    renderFocusedVideo({
      type: 'recordWithMedia',
      quote: quoteFixture(),
      media: { type: 'video', thumbnail: null, alt: 'clip', playlist: null },
    })

    fireEvent.keyDown(window, { key: 'v' })
    expect(document.querySelector('.b-video-player__video')).toBeNull()
  })

  it('plays a quoted video that has a playlist', () => {
    renderFocusedVideo({
      type: 'recordWithMedia',
      quote: quoteFixture(),
      media: {
        type: 'video',
        thumbnail: null,
        alt: 'clip',
        playlist: 'https://example.test/clip.m3u8',
      },
    })

    expect(document.querySelector('.b-video-player__poster')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'v' })
    expect(document.querySelector('.b-video-player__video')).not.toBeNull()
  })
})

describe('PostCard identity ownership', () => {
  function signIn() {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
  }

  function ownPost(index: number) {
    return postFixture({ uri: `at://did:plc:test/app.bsky.feed.post/${index}` })
  }

  function cardTree(post: PostModel) {
    return (
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <PostCard post={post} focused />
        </Router>
      </QueryClientProvider>
    )
  }

  it('drops a clipboard completion from a replaced card', async () => {
    const pending = Promise.withResolvers<void>()
    const writeText = vi.fn(() => pending.promise)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    const { rerender } = render(cardTree(postFixture()))
    fireEvent.keyDown(window, { key: 'y' })
    expect(writeText).toHaveBeenCalledTimes(1)

    // the same mounted component now shows another post
    rerender(cardTree(postFixture({ uri: 'at://did:plc:test/app.bsky.feed.post/other' })))
    pending.resolve()
    await act(async () => undefined)

    expect(screen.queryByRole('button', { name: 'copied' })).toBeNull()
    expect(screen.getByRole('button', { name: 'copy link' })).toBeInTheDocument()
  })

  it('drops a generator-feedback completion from a replaced card', async () => {
    signIn()
    const gate = Promise.withResolvers<void>()
    const onFeedback = vi.fn((_post: PostModel, _event: FeedFeedbackEvent) => gate.promise)
    const tree = (post: PostModel) => (
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <PostCard post={post} focused onFeedback={onFeedback} />
        </Router>
      </QueryClientProvider>
    )

    const { rerender } = render(tree(postFixture()))
    fireEvent.keyDown(window, { key: '+' })
    expect(onFeedback.mock.calls[0]?.[1]).toBe('more')

    rerender(tree(postFixture({ uri: 'at://did:plc:test/app.bsky.feed.post/other' })))
    gate.resolve()
    await act(async () => undefined)

    // the new card never claims the previous card's sent feedback
    expect(document.querySelector('.b-post-card__feedback-sent')).toBeNull()
    expect(screen.getByRole('button', { name: 'more like this' })).toBeEnabled()
  })

  it('drops clipboard and feedback completions when the same post changes account', async () => {
    signIn()
    const pending = Promise.withResolvers<void>()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => pending.promise) },
    })
    const post = postFixture()
    const { rerender } = render(cardTree(post))
    fireEvent.keyDown(window, { key: 'y' })
    expect(screen.queryByRole('button', { name: 'copied' })).toBeNull()

    // the uri is unchanged; only the signed-in account moves, which is still a
    // different owner for this surface
    act(() => {
      useAuthStore.setState({ account: { did: 'did:plc:other', handle: 'other.test' } })
    })
    pending.resolve()
    await act(async () => undefined)
    expect(screen.queryByRole('button', { name: 'copied' })).toBeNull()
    expect(screen.getByRole('button', { name: 'copy link' })).toBeInTheDocument()

    const gate = Promise.withResolvers<void>()
    const onFeedback = vi.fn((_post: PostModel, _event: FeedFeedbackEvent) => gate.promise)
    const onDismiss = vi.fn()
    rerender(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <PostCard post={post} focused onFeedback={onFeedback} onDismiss={onDismiss} />
        </Router>
      </QueryClientProvider>,
    )
    fireEvent.keyDown(window, { key: '-' })
    await vi.waitFor(() => expect(onFeedback).toHaveBeenCalledTimes(1))
    act(() => {
      useAuthStore.setState({ account: { did: 'did:plc:test', handle: 'test.bsky.social' } })
    })
    gate.resolve()
    await act(async () => undefined)

    // a less signal that lands after the owner changed never dismisses
    expect(onDismiss).not.toHaveBeenCalled()
    expect(document.querySelector('.b-post-card__feedback-sent')).toBeNull()
  })

  it('drops a delete completion from a replaced card but still invalidates reads', async () => {
    signIn()
    const gate = Promise.withResolvers<void>()
    vi.mocked(deletePost).mockReturnValue(gate.promise)
    const queryClient = createTestQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    const tree = (post: PostModel) => (
      <QueryClientProvider client={queryClient}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <PostCard post={post} focused />
        </Router>
      </QueryClientProvider>
    )
    const { rerender } = render(tree(ownPost(1)))
    fireEvent.keyDown(window, { key: 'd' })
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() =>
      expect(deletePost).toHaveBeenCalledWith('at://did:plc:test/app.bsky.feed.post/1'),
    )

    rerender(tree(ownPost(2)))
    gate.resolve()
    await act(async () => undefined)

    // the old write's result must not paint on the new card
    expect(screen.queryByText('post deleted')).toBeNull()
    expect(screen.queryByRole('button', { name: 'confirm delete' })).toBeNull()
    // but the server-derived reads it changed are still refreshed
    expect(invalidate).toHaveBeenCalled()
  })

  it('drops a delete completion that lands after unmount', async () => {
    signIn()
    const gate = Promise.withResolvers<void>()
    vi.mocked(deletePost).mockReturnValue(gate.promise)
    const location = memoryLocation({ path: '/' })
    const queryClient = createTestQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={ownPost(1)} focused />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.keyDown(window, { key: 'd' })
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(deletePost).toHaveBeenCalledTimes(1))
    unmount()
    gate.resolve()
    await act(async () => undefined)

    expect(invalidate).toHaveBeenCalled()
  })
})
