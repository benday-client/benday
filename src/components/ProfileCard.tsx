import { type Query, type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../lib/auth'
import { focusOwningDeck } from '../lib/deckFocus'
import { errorInfo } from '../lib/errors'
import { block, follow, mute, unblock, unfollow, unmute } from '../lib/profileActions'
import { isRecord } from '../lib/records'
import type { ProfileModel, ProfileViewerState } from '../lib/types'
import { Avatar } from './Avatar'
import { DitherImage } from './DitherImage'
import { Frame, Tag } from './ui'

interface ProfileIdentity {
  viewerDid: string
  profileDid: string
}

export interface ProfileCardProps {
  profile: ProfileModel
}

type ProfileAction = 'follow' | 'unfollow' | 'mute' | 'unmute' | 'block' | 'unblock'

// one attempt token per viewer and profile on a query client, so a remounted
// card and an older action share a slot: only the newest attempt may settle
const profileAttempts = new WeakMap<QueryClient, Map<string, symbol>>()

function profileAttemptKey(identity: ProfileIdentity): string {
  return `${identity.viewerDid}\n${identity.profileDid}`
}

function startProfileAttempt(queryClient: QueryClient, identity: ProfileIdentity): symbol {
  const key = profileAttemptKey(identity)
  let attempts = profileAttempts.get(queryClient)
  if (attempts === undefined) {
    attempts = new Map()
    profileAttempts.set(queryClient, attempts)
  }
  const attempt = Symbol(key)
  attempts.set(key, attempt)
  return attempt
}

/** a profile query this account owns for the action's profile, by key and did */
function ownsProfileQuery(query: Query, identity: ProfileIdentity): boolean {
  if (query.queryKey[0] !== 'profile' || query.queryKey[2] !== identity.viewerDid) return false
  const data = query.state.data
  return isRecord(data) && data['did'] === identity.profileDid
}

function httpUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function linkTitle(url: string, title: string): string {
  const trimmed = title.trim()
  if (trimmed.length > 0) return trimmed
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * A failed action may only take back the fields it guessed about: anything a
 * newer fetch wrote to the same viewer stays, and an action without an
 * optimistic patch never touches the cache at all.
 */
function rollbackViewer(
  optimistic: Partial<ProfileViewerState> | null,
  previous: ProfileViewerState,
): Partial<ProfileViewerState> | null {
  if (optimistic === null) return null
  const patch: Partial<ProfileViewerState> = {}
  if ('following' in optimistic) patch.following = previous.following
  if ('followedBy' in optimistic) patch.followedBy = previous.followedBy
  if ('muted' in optimistic) patch.muted = previous.muted
  if ('mutedOnlyReposts' in optimistic) patch.mutedOnlyReposts = previous.mutedOnlyReposts
  if ('mutedOnlyQuoteposts' in optimistic) patch.mutedOnlyQuoteposts = previous.mutedOnlyQuoteposts
  if ('blocking' in optimistic) patch.blocking = previous.blocking
  if ('blockedBy' in optimistic) patch.blockedBy = previous.blockedBy
  return patch
}

export function ProfileCard({ profile }: ProfileCardProps) {
  const queryClient = useQueryClient()
  const actionsRef = useRef<HTMLFieldSetElement>(null)
  const [pending, setPending] = useState<ProfileAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handle = profile.handle.length > 0 ? profile.handle : 'unknown'
  const displayName = profile.displayName.length > 0 ? profile.displayName : handle
  const viewer = profile.viewer
  const signedInDid = useAuthStore((state) => state.account?.did ?? null)
  const isSelf = signedInDid !== null && signedInDid === profile.did
  const viewerIdentity = signedInDid ?? 'anonymous'
  // the identity a late action belongs to; a new account or profile owns the
  // UI from the next render on
  const identityRef = useRef<ProfileIdentity>({
    viewerDid: viewerIdentity,
    profileDid: profile.did,
  })
  identityRef.current = { viewerDid: viewerIdentity, profileDid: profile.did }

  useEffect(() => {
    setPending(null)
    setError(null)
  }, [viewerIdentity, profile.did])

  const links: { url: string; title: string }[] = []
  for (const link of profile.links) {
    const url = httpUrl(link.url)
    if (url === null) continue
    links.push({ url, title: linkTitle(url, link.title) })
  }

  const relationships = [
    viewer.followedBy !== null ? 'follows you' : null,
    viewer.muted ? 'muted' : null,
    viewer.mutedOnlyReposts ? 'reposts hidden' : null,
    viewer.mutedOnlyQuoteposts ? 'quoteposts hidden' : null,
    viewer.blocking !== null ? 'blocked' : viewer.blockedBy ? 'blocked by' : null,
  ].filter((note): note is string => note !== null)

  const applyViewer = (patch: Partial<ProfileViewerState>, identity: ProfileIdentity) => {
    // cross-host patches for the same account stay; another viewer or another
    // profile's cache entry never receives this state
    queryClient.setQueriesData<ProfileModel>(
      { predicate: (query) => ownsProfileQuery(query, identity) },
      (current) => {
        if (current === undefined) return current
        return { ...current, viewer: { ...current.viewer, ...patch } }
      },
    )
  }

  const runAction = async (
    action: ProfileAction,
    task: () => Promise<Partial<ProfileViewerState> | null>,
    optimistic: Partial<ProfileViewerState> | null,
  ) => {
    if (pending !== null) return

    const captured = identityRef.current
    const attempt = startProfileAttempt(queryClient, captured)
    const previous = profile.viewer
    // a remount shares this token slot, so an older completion can no longer
    // overwrite the newer surface or its cache
    const owns = () =>
      profileAttempts.get(queryClient)?.get(profileAttemptKey(captured)) === attempt &&
      (useAuthStore.getState().account?.did ?? 'anonymous') === captured.viewerDid &&
      identityRef.current.profileDid === captured.profileDid

    // every action disables the toolbar while it runs; move the keyboard to
    // the owning deck before the focused control becomes unreachable
    focusOwningDeck(actionsRef.current)
    setPending(action)
    setError(null)

    // a profile fetch that started before this action would land with the
    // pre-action viewer state, so it is cancelled before the guess is written
    await queryClient.cancelQueries({ predicate: (query) => ownsProfileQuery(query, captured) })
    if (!owns()) return
    if (optimistic !== null) applyViewer(optimistic, captured)

    try {
      const patch = await task()
      if (patch !== null && owns()) applyViewer(patch, captured)
    } catch (reason: unknown) {
      if (!owns()) return
      const rollback = rollbackViewer(optimistic, previous)
      if (rollback !== null) applyViewer(rollback, captured)
      setError(errorInfo(reason).detail)
    } finally {
      if (owns()) setPending(null)
    }
  }

  const toggling = pending !== null

  return (
    <Frame label="profile" className="b-profile-card">
      <div className="b-profile__body">
        <div className="b-profile__banner">
          <DitherImage
            src={profile.banner}
            alt={`banner of @${handle}`}
            className="b-profile__banner-image"
            fallback="▚"
          />
        </div>

        <div className="b-profile__identity">
          <span className="b-profile__avatar">
            <Avatar src={profile.avatar} alt={`avatar of @${handle}`} name={displayName} />
          </span>
          <span className="b-profile__names">
            <span className="b-profile__name-row">
              <span className="b-profile__name">{displayName}</span>
              {profile.isBot ? (
                <span className="b-profile__bot">
                  <Tag tone="accent" title="automated account">
                    bot
                  </Tag>
                </span>
              ) : null}
            </span>
            <span className="b-profile__handle-row">
              <span className="b-profile__handle">@{handle}</span>
              {profile.pronouns.length > 0 ? (
                <span className="b-profile__pronouns">{profile.pronouns}</span>
              ) : null}
            </span>
          </span>
        </div>

        {relationships.length > 0 ? (
          <div className="b-profile__relationships">
            {relationships.map((note) => (
              <Tag
                key={note}
                tone={note === 'blocked' || note === 'blocked by' ? 'warn' : 'default'}
              >
                {note}
              </Tag>
            ))}
          </div>
        ) : null}

        {profile.description.length > 0 ? (
          <p className="b-profile__bio">{profile.description}</p>
        ) : null}

        {links.length > 0 ? (
          <ul className="b-profile__links" aria-label="profile links">
            {links.map((link) => (
              <li key={link.url} className="b-profile__link">
                <a href={link.url} target="_blank" rel="noreferrer noopener">
                  {link.title}
                  <span aria-hidden="true"> ↗</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        {isSelf ? null : (
          <fieldset
            className="b-profile__actions"
            ref={actionsRef}
            aria-busy={toggling ? 'true' : undefined}
          >
            <legend className="visually-hidden">profile actions</legend>
            <button
              type="button"
              className="b-post-card__action"
              data-kind="follow"
              data-active={viewer.following !== null ? 'true' : 'false'}
              disabled={toggling}
              onClick={() => {
                if (viewer.following !== null) {
                  const followUri = viewer.following
                  void runAction(
                    'unfollow',
                    async () => {
                      await unfollow(followUri)
                      return { following: null }
                    },
                    null,
                  )
                  return
                }
                void runAction(
                  'follow',
                  async () => {
                    const result = await follow(profile.did)
                    return { following: result.uri }
                  },
                  null,
                )
              }}
            >
              {pending === 'follow'
                ? 'following'
                : pending === 'unfollow'
                  ? 'unfollowing'
                  : viewer.following !== null
                    ? 'unfollow'
                    : 'follow'}
            </button>

            <button
              type="button"
              className="b-post-card__action"
              data-kind="mute"
              data-active={viewer.muted ? 'true' : 'false'}
              disabled={toggling}
              onClick={() => {
                if (viewer.muted) {
                  void runAction(
                    'unmute',
                    async () => {
                      await unmute(profile.did)
                      return { muted: false, mutedOnlyReposts: false, mutedOnlyQuoteposts: false }
                    },
                    { muted: false, mutedOnlyReposts: false, mutedOnlyQuoteposts: false },
                  )
                  return
                }
                void runAction(
                  'mute',
                  async () => {
                    await mute(profile.did)
                    return { muted: true, mutedOnlyReposts: false, mutedOnlyQuoteposts: false }
                  },
                  { muted: true, mutedOnlyReposts: false, mutedOnlyQuoteposts: false },
                )
              }}
            >
              {pending === 'mute'
                ? 'muting'
                : pending === 'unmute'
                  ? 'unmuting'
                  : viewer.muted
                    ? 'unmute'
                    : 'mute'}
            </button>

            <button
              type="button"
              className="b-post-card__action b-post-card__action--danger"
              data-kind="block"
              data-active={viewer.blocking !== null ? 'true' : 'false'}
              disabled={toggling}
              onClick={() => {
                if (viewer.blocking !== null) {
                  const blockUri = viewer.blocking
                  void runAction(
                    'unblock',
                    async () => {
                      await unblock(blockUri)
                      return { blocking: null }
                    },
                    { blocking: null },
                  )
                  return
                }
                void runAction(
                  'block',
                  async () => {
                    const result = await block(profile.did)
                    return { blocking: result.uri }
                  },
                  null,
                )
              }}
            >
              {pending === 'block'
                ? 'blocking'
                : pending === 'unblock'
                  ? 'unblocking'
                  : viewer.blocking !== null
                    ? 'unblock'
                    : 'block'}
            </button>
          </fieldset>
        )}

        {error !== null ? (
          <p className="b-profile__action-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Frame>
  )
}
