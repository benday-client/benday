// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the deck stand-in is a focusable scroll region, like Deck.tsx
import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../lib/auth'
import { follow, mute, unmute } from '../lib/profileActions'
import type { ProfileModel } from '../lib/types'
import { profileFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { ProfileCard } from './ProfileCard'

vi.mock('../lib/profileActions', () => ({
  follow: vi.fn(),
  unfollow: vi.fn(),
  mute: vi.fn(),
  unmute: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
}))

function renderProfile(profile: ProfileModel, queryClient = createTestQueryClient()) {
  const view = (next: ProfileModel) => (
    <QueryClientProvider client={queryClient}>
      <ol className="b-deck" tabIndex={0} aria-label="profile deck">
        <li data-deck-index="0">
          <ProfileCard profile={next} />
        </li>
      </ol>
    </QueryClientProvider>
  )
  const result = render(view(profile))
  return {
    ...result,
    queryClient,
    rerenderProfile: (next: ProfileModel) => result.rerender(view(next)),
  }
}

const BASE_VIEWER: ProfileModel['viewer'] = {
  following: null,
  followedBy: null,
  muted: false,
  mutedOnlyReposts: false,
  mutedOnlyQuoteposts: false,
  blocking: null,
  blockedBy: false,
  activitySubscription: null,
}

/** The query the profile view would own for this viewer and actor. */
function seedProfile(queryClient: QueryClient, profile: ProfileModel, viewerDid: string) {
  const key = ['profile', profile.handle, viewerDid]
  queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY })
  queryClient.setQueryData(key, profile)
  return key
}

function signedIn(did = 'did:plc:me', handle = 'me.test') {
  useAuthStore.setState({
    status: 'authenticated',
    account: { did, handle },
    pending: false,
    error: null,
  })
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

  it('keeps the relationship actions for someone else and no notification picker', () => {
    signedIn()

    renderProfile(profileFixture())

    expect(screen.getByRole('button', { name: 'follow' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'mute' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'block' })).toBeInTheDocument()
    // per-profile activity editing is gone; incoming notifications still read
    expect(screen.queryByRole('button', { name: /notifications/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'hide reposts' })).toBeNull()
  })

  it('renders public identity while the private relationship state drives actions', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })

    renderProfile(
      profileFixture({
        displayName: 'custom host name',
        viewer: {
          following: 'at://did:plc:me/app.bsky.graph.follow/1',
          followedBy: null,
          muted: true,
          mutedOnlyReposts: false,
          mutedOnlyQuoteposts: false,
          blocking: null,
          blockedBy: false,
          activitySubscription: { post: true, reply: false },
        },
      }),
    )

    expect(screen.getByText('custom host name')).toBeInTheDocument()
    // the label already states the resulting action, so a pressed state would
    // contradict it; the visual mark rides on data-active instead
    const unfollow = screen.getByRole('button', { name: 'unfollow' })
    expect(unfollow).not.toHaveAttribute('aria-pressed')
    expect(unfollow).toHaveAttribute('data-active', 'true')
    const unmute = screen.getByRole('button', { name: 'unmute' })
    expect(unmute).not.toHaveAttribute('aria-pressed')
    expect(unmute).toHaveAttribute('data-active', 'true')
    expect(screen.getByText('muted')).toBeInTheDocument()
  })

  it('omits totals, the joined date and non-bot account labels', () => {
    signedIn()

    renderProfile(
      profileFixture({
        followersCount: 9,
        followsCount: 8,
        postsCount: 7,
        createdAt: '2020-01-01T00:00:00.000Z',
        labels: ['porn', 'graphic-media'],
      }),
    )

    expect(screen.queryByText('followers')).toBeNull()
    expect(screen.queryByText('following')).toBeNull()
    expect(screen.queryByText('posts')).toBeNull()
    expect(screen.queryByText(/^joined /)).toBeNull()
    expect(screen.queryByText('porn')).toBeNull()
    expect(screen.queryByText('graphic-media')).toBeNull()
  })

  it('keeps follows-you, mute-scope and block badges truthful', () => {
    signedIn()

    renderProfile(
      profileFixture({
        viewer: {
          ...BASE_VIEWER,
          followedBy: 'at://did:plc:test/app.bsky.graph.follow/back',
          mutedOnlyQuoteposts: true,
          blocking: 'at://did:plc:me/app.bsky.graph.block/1',
        },
      }),
    )

    expect(screen.getByText('follows you')).toBeInTheDocument()
    expect(screen.getByText('quoteposts hidden')).toBeInTheDocument()
    expect(screen.getByText('blocked')).toBeInTheDocument()
    // incoming notification reading and stored subscription state stay in the
    // model; the card simply offers no subscription editor
    expect(screen.queryByRole('button', { name: /notifications/ })).toBeNull()
  })

  it('renders stored mute scopes as read badges without muting controls', () => {
    signedIn()

    renderProfile(profileFixture({ viewer: { ...BASE_VIEWER, mutedOnlyReposts: true } }))

    expect(screen.getByText('reposts hidden')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reposts/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'mute' })).toBeEnabled()
  })

  it("ignores a previous account's settle on another profile", async () => {
    const gate = Promise.withResolvers<void>()
    vi.mocked(mute).mockReturnValueOnce(gate.promise)

    const queryClient = createTestQueryClient()
    const alpha = profileFixture({ did: 'did:plc:alpha', handle: 'alpha.test' })
    const bravo = profileFixture({ did: 'did:plc:bravo', handle: 'bravo.test' })
    // the production key is ['profile', actor, viewer]; one viewer keeps both
    // entries under the same viewer slot, so only the did inside each entry
    // decides which cache entry an action may patch
    const alphaKey = seedProfile(queryClient, alpha, 'did:plc:alice')
    const bravoKey = seedProfile(queryClient, bravo, 'did:plc:alice')

    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:alice', handle: 'alice.test' },
      pending: false,
      error: null,
    })

    const { rerenderProfile } = renderProfile(alpha, queryClient)
    fireEvent.click(screen.getByRole('button', { name: 'mute' }))

    // the optimistic patch lands on the visible profile's entry and leaves the
    // other profile under the same viewer alone
    await waitFor(() =>
      expect(queryClient.getQueryData<ProfileModel>(alphaKey)?.viewer.muted).toBe(true),
    )
    expect(queryClient.getQueryData(bravoKey)).toEqual(bravo)

    act(() => {
      useAuthStore.setState({ account: { did: 'did:plc:bob', handle: 'bob.test' } })
    })
    rerenderProfile(bravo)

    await act(async () => {
      gate.reject(new Error('mute refused'))
    })

    // the stale settle belongs to the old epoch: it rolls nothing back, writes
    // no other profile's cache and raises no alert on the new one
    expect(queryClient.getQueryData<ProfileModel>(alphaKey)?.viewer.muted).toBe(true)
    expect(queryClient.getQueryData(bravoKey)).toEqual(bravo)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'mute' })).toBeEnabled()
  })

  it('leaves newer cache fields alone when an optimistic-free follow fails', async () => {
    const gate = Promise.withResolvers<never>()
    vi.mocked(follow).mockReturnValueOnce(gate.promise)
    signedIn()

    const queryClient = createTestQueryClient()
    const alpha = profileFixture({ did: 'did:plc:alpha', handle: 'alpha.test' })
    const key = seedProfile(queryClient, alpha, 'did:plc:me')

    renderProfile(alpha, queryClient)
    fireEvent.click(screen.getByRole('button', { name: 'follow' }))

    // a newer fetch lands while the follow is still in flight
    const fetched: ProfileModel = {
      ...alpha,
      viewer: {
        ...alpha.viewer,
        followedBy: 'at://did:plc:alpha/app.bsky.graph.follow/7',
        mutedOnlyQuoteposts: true,
      },
    }
    queryClient.setQueryData(key, fetched)

    await act(async () => {
      gate.reject(new Error('follow refused'))
    })

    expect(queryClient.getQueryData(key)).toEqual(fetched)
    expect(screen.getByRole('alert')).toHaveTextContent('follow refused')
    expect(screen.getByRole('button', { name: 'follow' })).toBeEnabled()
  })

  it('rolls back only the fields an optimistic mute patched', async () => {
    const gate = Promise.withResolvers<void>()
    vi.mocked(mute).mockReturnValueOnce(gate.promise)
    signedIn()

    const queryClient = createTestQueryClient()
    const alpha = profileFixture({ did: 'did:plc:alpha', handle: 'alpha.test' })
    const key = seedProfile(queryClient, alpha, 'did:plc:me')

    renderProfile(alpha, queryClient)
    fireEvent.click(screen.getByRole('button', { name: 'mute' }))
    await waitFor(() =>
      expect(queryClient.getQueryData<ProfileModel>(key)?.viewer.muted).toBe(true),
    )

    const fetched: ProfileModel = {
      ...alpha,
      viewer: {
        ...alpha.viewer,
        muted: true,
        followedBy: 'at://did:plc:alpha/app.bsky.graph.follow/9',
        activitySubscription: { post: true, reply: true },
      },
    }
    queryClient.setQueryData(key, fetched)

    await act(async () => {
      gate.reject(new Error('mute refused'))
    })

    expect(queryClient.getQueryData<ProfileModel>(key)?.viewer).toEqual({
      ...alpha.viewer,
      followedBy: fetched.viewer.followedBy,
      activitySubscription: fetched.viewer.activitySubscription,
    })
    expect(screen.getByRole('alert')).toHaveTextContent('mute refused')
  })

  it('keeps a newer action result when an older mount settles late', async () => {
    const stale = Promise.withResolvers<void>()
    const current = Promise.withResolvers<void>()
    vi.mocked(mute).mockReturnValueOnce(stale.promise)
    vi.mocked(unmute).mockReturnValueOnce(current.promise)
    signedIn()

    const queryClient = createTestQueryClient()
    const alpha = profileFixture({ did: 'did:plc:alpha', handle: 'alpha.test' })
    const key = seedProfile(queryClient, alpha, 'did:plc:me')
    const { unmount } = renderProfile(alpha, queryClient)

    fireEvent.click(screen.getByRole('button', { name: 'mute' }))
    await waitFor(() =>
      expect(queryClient.getQueryData<ProfileModel>(key)?.viewer.muted).toBe(true),
    )

    unmount()
    const cached = queryClient.getQueryData<ProfileModel>(key)
    if (cached === undefined) throw new Error('profile cache missing')

    // the remounted card starts from the optimistic state and unmutes it
    renderProfile(cached, queryClient)
    fireEvent.click(screen.getByRole('button', { name: 'unmute' }))
    await waitFor(() =>
      expect(queryClient.getQueryData<ProfileModel>(key)?.viewer.muted).toBe(false),
    )
    await act(async () => {
      current.resolve()
    })

    // the older mute settles last, but the newer attempt owns the pair now
    const settled = Promise.withResolvers<void>()
    await act(async () => {
      stale.resolve()
      setTimeout(() => {
        settled.resolve()
      }, 0)
      await settled.promise
    })
    expect(queryClient.getQueryData<ProfileModel>(key)?.viewer.muted).toBe(false)
  })
})

describe('ProfileCard action feedback', () => {
  it('hands focus to the owning deck before the pressed action is disabled', async () => {
    const gate = Promise.withResolvers<void>()
    vi.mocked(mute).mockReturnValueOnce(gate.promise)
    signedIn()

    const profile = profileFixture()
    const queryClient = createTestQueryClient()
    seedProfile(queryClient, profile, 'did:plc:me')
    renderProfile(profile, queryClient)

    const deck = screen.getByRole('list', { name: 'profile deck' })
    const muteButton = screen.getByRole('button', { name: 'mute' })
    muteButton.focus()
    fireEvent.click(muteButton)

    // the focused control disables itself, so the card hands the keyboard on
    expect(muteButton).toBeDisabled()
    expect(deck).toHaveFocus()
    const actions = muteButton.closest('fieldset')
    expect(actions).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      gate.resolve()
    })
    expect(screen.getByRole('button', { name: 'mute' })).toBeEnabled()
    expect(actions).not.toHaveAttribute('aria-busy')
  })
})
