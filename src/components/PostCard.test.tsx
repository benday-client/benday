import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { displayedCount, useActionStore } from '../lib/actionStore'
import { useAuthStore } from '../lib/auth'
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
  beforeEach(() => {
    useAuthStore.setState({
      status: 'anonymous',
      account: null,
      pending: false,
      error: null,
    })
    useUiStore.setState({ dialog: null, compose: null })
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
    fireEvent.keyDown(window, { key: '-' })

    expect(feedback).toHaveBeenNthCalledWith(1, 'more')
    expect(feedback).toHaveBeenNthCalledWith(2, 'less')
  })

  it('opens sign in when a signed-out user likes a post', () => {
    const location = memoryLocation({ path: '/' })
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <PostCard post={postFixture()} />
        </Router>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /like/ }))
    expect(useUiStore.getState().dialog).toBe('login')
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
