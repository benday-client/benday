import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { displayedCount, useActionStore } from '../lib/actionStore'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import { useUiStore } from '../lib/ui'
import { postFixture } from '../test/fixtures'
import { PostCard } from './PostCard'

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

describe('PostCard actions', () => {
  afterEach(() => {
    vi.useRealTimers()
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
    useActionStore.setState({ byUri: {} })
  })

  it('shows its feed position only when given an index', () => {
    const location = memoryLocation({ path: '/' })
    const queryClient = new QueryClient()
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

  it('dismisses the card after a less feedback', () => {
    vi.useFakeTimers()
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const feedback = vi.fn()
    const dismiss = vi.fn()
    const location = memoryLocation({ path: '/' })
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused onFeedback={feedback} onDismiss={dismiss} />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'less like this' }))
    expect(feedback).toHaveBeenCalledWith('less')
    act(() => {
      vi.advanceTimersByTime(240)
    })
    expect(dismiss).toHaveBeenCalled()
  })

  it('sends feed feedback from the focused card keys', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const feedback = vi.fn()
    const location = memoryLocation({ path: '/' })
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused onFeedback={feedback} />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('button', { name: 'more like this' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'less like this' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '+' })

    expect(feedback).toHaveBeenCalledWith('more')
    expect(screen.queryByRole('button', { name: 'more like this' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'less like this' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('feedback sent to the feed operator')
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
    const queryClient = new QueryClient()
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
    const queryClient = new QueryClient()
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
    const queryClient = new QueryClient()
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
    const queryClient = new QueryClient()
    const quoted = {
      uri: 'at://did:plc:test/app.bsky.feed.post/quoted',
      cid: 'quoted-cid',
      author: {
        did: 'did:plc:quoted',
        handle: 'quoted.test',
        displayName: 'quoted',
        avatar: null,
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

  it('opens a quoted post when the quote card is clicked', () => {
    const location = memoryLocation({ path: '/', record: true })
    const queryClient = new QueryClient()
    const quoted = {
      uri: 'at://did:plc:test/app.bsky.feed.post/quoted',
      cid: 'quoted-cid',
      author: {
        did: 'did:plc:quoted',
        handle: 'quoted.test',
        displayName: 'quoted',
        avatar: null,
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

  it('opens the focused post thread when a reply row is clicked', async () => {
    const location = memoryLocation({ path: '/', record: true })
    const queryClient = new QueryClient()
    const post = postFixture({ replyCount: 1 })
    const reply = postFixture({
      uri: 'at://did:plc:test/app.bsky.feed.post/reply-1',
      text: 'a reply that opens',
    })
    queryClient.setQueryData(
      ['top-comments', useSettings.getState().appView.host, post.uri],
      [reply],
    )

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={post} />
        </Router>
      </QueryClientProvider>,
    )

    await screen.findByText('a reply that opens')
    const row = document.querySelector('.b-post-card__comment')
    expect(row).not.toBeNull()
    fireEvent.click(row as Element)
    expect(location.history.at(-1)).toBe(`/thread?uri=${encodeURIComponent(reply.uri)}`)
  })

  it('opens a quoted post with 0 even when the post owns a reply list', () => {
    const location = memoryLocation({ path: '/', record: true })
    const queryClient = new QueryClient()
    const quoted = {
      uri: 'at://did:plc:test/app.bsky.feed.post/quoted',
      cid: 'quoted-cid',
      author: {
        did: 'did:plc:quoted',
        handle: 'quoted.test',
        displayName: 'quoted',
        avatar: null,
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

  it('hides the interaction bar when signed out', () => {
    const location = memoryLocation({ path: '/' })
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('button', { name: /like/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reply/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /re 0/ })).not.toBeInTheDocument()
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
    const queryClient = new QueryClient()
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

  it('opens sign in from the focused-card like shortcut', () => {
    const location = memoryLocation({ path: '/' })
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.keyDown(window, { key: 'f' })
    expect(useUiStore.getState().dialog).toBe('login')
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
    const queryClient = new QueryClient()
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

  it('arms deletion from the focused-card shortcut without deleting', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
    const location = memoryLocation({ path: '/' })
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} focused />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.keyDown(window, { key: 'd' })
    expect(screen.getByRole('button', { name: 'confirm delete' })).toBeInTheDocument()
  })

  it('renders the parent preview for a reply', () => {
    const post = postFixture({
      replyContext: {
        uri: 'at://did:plc:parent/app.bsky.feed.post/1',
        cid: 'parent-cid',
        author: {
          did: 'did:plc:parent',
          handle: 'parent.bsky.social',
          displayName: 'parent',
          avatar: null,
        },
        text: 'the post being answered',
        facets: [],
        indexedAt: '2026-10-29T12:00:00.000Z',
      },
    })
    const location = memoryLocation({ path: '/' })
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={post} />
        </Router>
      </QueryClientProvider>,
    )

    expect(screen.getByText('replying to')).toBeInTheDocument()
    expect(screen.getByText('the post being answered')).toBeInTheDocument()
    expect(screen.getByText('@parent.bsky.social')).toBeInTheDocument()
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
    const queryClient = new QueryClient()
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
    const queryClient = new QueryClient()
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
          likeLocal: true,
          repostLocal: false,
          pending: null,
          error: null,
          checked: true,
        },
      },
    })
    const location = memoryLocation({ path: '/' })
    const queryClient = new QueryClient()
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
})
