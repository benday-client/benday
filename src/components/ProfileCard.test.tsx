import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '../lib/auth'
import type { ProfileModel } from '../lib/types'
import { ProfileCard } from './ProfileCard'

function profileFixture(overrides: Partial<ProfileModel> = {}): ProfileModel {
  return {
    did: 'did:plc:test',
    handle: 'test.bsky.social',
    displayName: 'test',
    description: '',
    pronouns: '',
    avatar: null,
    banner: null,
    followersCount: 0,
    followsCount: 0,
    postsCount: 0,
    createdAt: null,
    labels: [],
    links: [],
    isBot: false,
    viewer: {
      following: null,
      followedBy: null,
      muted: false,
      mutedOnlyReposts: false,
      mutedOnlyQuoteposts: false,
      blocking: null,
      blockedBy: false,
      activitySubscription: null,
    },
    ...overrides,
  }
}

function renderProfile(profile: ProfileModel) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfileCard profile={profile} />
    </QueryClientProvider>,
  )
}

describe('ProfileCard actions', () => {
  beforeEach(() => {
    useAuthStore.setState({
      status: 'anonymous',
      account: null,
      pending: false,
      error: null,
    })
  })

  it('hides every relationship action on the signed-in profile', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })

    renderProfile(profileFixture())

    expect(screen.queryByRole('button', { name: /follow/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'mute' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'hide reposts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'block' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /notifications/ })).not.toBeInTheDocument()
  })

  it('keeps the actions and opens the themed notification picker for someone else', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })

    renderProfile(profileFixture())

    expect(screen.getByRole('button', { name: 'follow' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'mute' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'hide reposts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'block' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'notifications, off' }))

    expect(screen.getByRole('listbox', { name: 'notifications' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(4)
    expect(screen.getByRole('option', { name: 'off' })).toHaveAttribute('aria-selected', 'true')
  })
})
