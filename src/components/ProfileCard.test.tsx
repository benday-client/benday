// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the deck stand-in is a focusable scroll region, like Deck.tsx
import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../lib/auth'
import { follow, mute, setActivitySubscription, showReposts } from '../lib/profileActions'
import type { ProfileModel } from '../lib/types'
import { profileFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { ProfileCard } from './ProfileCard'

vi.mock('../lib/profileActions', () => ({
  follow: vi.fn(),
  unfollow: vi.fn(),
  mute: vi.fn(),
  unmute: vi.fn(),
  hideReposts: vi.fn(),
  showReposts: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
  setActivitySubscription: vi.fn(),
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
  const key = ['profile', 'https://api.bsky.app', profile.handle, viewerDid]
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
    expect(
      screen.getByRole('button', { name: 'notifications, new posts only' }),
    ).toBeInTheDocument()
  })

  it('does not let a repost-only mute replace a full mute', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })

    renderProfile(
      profileFixture({
        viewer: {
          following: null,
          followedBy: null,
          muted: true,
          mutedOnlyReposts: false,
          mutedOnlyQuoteposts: false,
          blocking: null,
          blockedBy: false,
          activitySubscription: null,
        },
      }),
    )

    expect(screen.getByRole('button', { name: 'hide reposts' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'unmute' })).toBeEnabled()
  })

  it("ignores a previous account's settle on another profile", async () => {
    const gate = Promise.withResolvers<never>()
    vi.mocked(follow).mockReturnValueOnce(gate.promise as never)

    const queryClient = createTestQueryClient()
    const aliceKey = ['profile', 'custom.test', 'alpha.test', 'did:plc:alice']
    const bobKey = ['profile', 'custom.test', 'bravo.test', 'did:plc:bob']
    queryClient.setQueryDefaults(aliceKey, { gcTime: Number.POSITIVE_INFINITY })
    queryClient.setQueryDefaults(bobKey, { gcTime: Number.POSITIVE_INFINITY })

    const alpha = profileFixture({ did: 'did:plc:alpha', handle: 'alpha.test' })
    const bravo = profileFixture({ did: 'did:plc:bravo', handle: 'bravo.test' })
    queryClient.setQueryData(aliceKey, alpha)
    queryClient.setQueryData(bobKey, bravo)

    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:alice', handle: 'alice.test' },
      pending: false,
      error: null,
    })

    const { rerenderProfile } = renderProfile(alpha, queryClient)
    fireEvent.click(screen.getByRole('button', { name: 'follow' }))

    act(() => {
      useAuthStore.setState({ account: { did: 'did:plc:bob', handle: 'bob.test' } })
    })
    rerenderProfile(bravo)

    await act(async () => {
      gate.reject(new Error('follow refused'))
    })

    expect(queryClient.getQueryData(bobKey)).toEqual(bravo)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'follow' })).toBeEnabled()
  })

  it('leaves newer cache fields alone when an optimistic-free follow fails', async () => {
    const gate = Promise.withResolvers<never>()
    vi.mocked(follow).mockReturnValueOnce(gate.promise as never)
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
    expect(queryClient.getQueryData<ProfileModel>(key)?.viewer.muted).toBe(true)

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

  it('shows a quote-only hide and keeps the repost toggle disabled', () => {
    signedIn()

    const queryClient = createTestQueryClient()
    const profile = profileFixture({
      viewer: { ...BASE_VIEWER, mutedOnlyQuoteposts: true },
    })
    const key = seedProfile(queryClient, profile, 'did:plc:me')

    renderProfile(profile, queryClient)

    expect(screen.getByText('quoteposts hidden')).toBeInTheDocument()
    expect(screen.queryByText('reposts hidden')).not.toBeInTheDocument()
    expect(screen.queryByText('muted')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'hide reposts' })).toBeDisabled()
    expect(queryClient.getQueryData(key)).toEqual(profile)
  })

  it('undoes only repost hiding when quote posts stay hidden', async () => {
    const gate = Promise.withResolvers<void>()
    vi.mocked(showReposts).mockReturnValueOnce(gate.promise)
    signedIn()

    const queryClient = createTestQueryClient()
    const profile = profileFixture({
      viewer: { ...BASE_VIEWER, mutedOnlyReposts: true, mutedOnlyQuoteposts: true },
    })
    const key = seedProfile(queryClient, profile, 'did:plc:me')

    const { rerenderProfile } = renderProfile(profile, queryClient)

    expect(screen.getByText('reposts hidden')).toBeInTheDocument()
    expect(screen.getByText('quoteposts hidden')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'show reposts' })
    expect(button).toBeEnabled()

    fireEvent.click(button)

    expect(showReposts).toHaveBeenCalledWith('did:plc:test', true)
    const expected = { ...profile.viewer, muted: false, mutedOnlyReposts: false }
    expect(queryClient.getQueryData<ProfileModel>(key)?.viewer).toEqual(expected)

    const optimistic = queryClient.getQueryData<ProfileModel>(key)
    if (optimistic === undefined) throw new Error('missing patched profile')
    rerenderProfile(optimistic)
    expect(screen.getByText('quoteposts hidden')).toBeInTheDocument()
    expect(screen.queryByText('reposts hidden')).not.toBeInTheDocument()

    await act(async () => {
      gate.resolve()
    })
    expect(queryClient.getQueryData<ProfileModel>(key)?.viewer).toEqual(expected)
  })

  it('keeps its menu open while the menu itself scrolls and restores focus on close', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })

    renderProfile(profileFixture())

    const trigger = screen.getByRole('button', { name: 'notifications, off' })
    fireEvent.click(trigger)
    const menu = document.querySelector('.b-profile__notify-menu')
    if (menu === null) throw new Error('picker did not open')

    fireEvent.scroll(menu)
    expect(document.querySelector('.b-profile__notify-menu')).not.toBeNull()

    // the real picker focuses the active option, so escape starts inside it
    const option = screen.getByRole('option', { name: 'all activity' })
    option.focus()
    fireEvent.keyDown(option, { key: 'Escape' })

    expect(document.querySelector('.b-profile__notify-menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
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

  it('returns focus to its opener when a viewport change closes a focused menu', () => {
    signedIn()
    renderProfile(profileFixture())

    const trigger = screen.getByRole('button', { name: 'notifications, off' })
    fireEvent.click(trigger)
    const option = screen.getByRole('option', { name: 'all activity' })
    option.focus()

    fireEvent.scroll(window)

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('hands keyboard ownership to the deck when a picker option starts an action', () => {
    vi.mocked(setActivitySubscription).mockReturnValueOnce(new Promise<never>(() => {}))
    signedIn()
    renderProfile(profileFixture())

    const deck = screen.getByRole('list', { name: 'profile deck' })
    fireEvent.click(screen.getByRole('button', { name: 'notifications, off' }))
    const option = screen.getByRole('option', { name: 'off' })
    option.focus()

    fireEvent.keyDown(option, { key: 'Enter' })

    expect(document.activeElement).toBe(deck)
  })
})
