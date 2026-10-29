import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useAuthStore } from '../lib/auth'
import { useUiStore } from '../lib/ui'
import { postFixture } from '../test/fixtures'
import { PostCard } from './PostCard'

describe('PostCard actions', () => {
  beforeEach(() => {
    useAuthStore.setState({
      status: 'anonymous',
      account: null,
      pending: false,
      error: null,
    })
    useUiStore.setState({ dialog: null, compose: null })
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
})
