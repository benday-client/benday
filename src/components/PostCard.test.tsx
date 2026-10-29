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
    render(
      <Router hook={location.hook}>
        <PostCard post={postFixture()} />
      </Router>,
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
    render(
      <Router hook={location.hook}>
        <PostCard post={post} />
      </Router>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'reply' }))
    expect(useUiStore.getState().compose).toEqual({ mode: 'reply', post })
  })
})
