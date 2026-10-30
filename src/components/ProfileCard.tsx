import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuthStore } from '../lib/auth'
import { errorInfo } from '../lib/errors'
import {
  block,
  follow,
  hideReposts,
  mute,
  setActivitySubscription,
  showReposts,
  unblock,
  unfollow,
  unmute,
} from '../lib/profileActions'
import { formatAbsoluteTime } from '../lib/time'
import type { ProfileModel, ProfileViewerState } from '../lib/types'
import { useUiStore } from '../lib/ui'
import { DitherImage } from './DitherImage'
import { Frame, Tag } from './ui'

export interface ProfileCardProps {
  profile: ProfileModel
}

type ProfileAction =
  | 'follow'
  | 'unfollow'
  | 'mute'
  | 'unmute'
  | 'hide-reposts'
  | 'show-reposts'
  | 'block'
  | 'unblock'
  | 'notify-post'
  | 'notify-reply'

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

export function ProfileCard({ profile }: ProfileCardProps) {
  const queryClient = useQueryClient()
  const openDialog = useUiStore((state) => state.openDialog)
  const [pending, setPending] = useState<ProfileAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handle = profile.handle.length > 0 ? profile.handle : 'unknown'
  const displayName = profile.displayName.length > 0 ? profile.displayName : handle
  const initial = (displayName.length > 0 ? displayName : '?').slice(0, 1).toUpperCase()
  const viewer = profile.viewer

  const counts = [
    { label: 'followers', value: profile.followersCount },
    { label: 'following', value: profile.followsCount },
    { label: 'posts', value: profile.postsCount },
  ] as const

  const labels = profile.labels.filter((label) => label.toLowerCase() !== 'bot')
  const links: { url: string; title: string }[] = []
  for (const link of profile.links) {
    const url = httpUrl(link.url)
    if (url === null) continue
    links.push({ url, title: linkTitle(url, link.title) })
  }

  const relationships = [
    viewer.followedBy !== null ? 'follows you' : null,
    viewer.muted ? 'muted' : viewer.mutedOnlyReposts ? 'reposts hidden' : null,
    viewer.blocking !== null ? 'blocked' : viewer.blockedBy ? 'blocked by' : null,
  ].filter((note): note is string => note !== null)

  const applyViewer = (patch: Partial<ProfileViewerState>) => {
    queryClient.setQueriesData<ProfileModel>({ queryKey: ['profile'] }, (current) => {
      if (current === undefined || current.did !== profile.did) return current
      return { ...current, viewer: { ...current.viewer, ...patch } }
    })
  }

  const runAction = (
    action: ProfileAction,
    task: () => Promise<Partial<ProfileViewerState> | null>,
    optimistic: Partial<ProfileViewerState> | null,
  ) => {
    if (useAuthStore.getState().status !== 'authenticated') {
      openDialog('login')
      return
    }
    if (pending !== null) return

    const previous = profile.viewer
    setPending(action)
    setError(null)
    if (optimistic !== null) applyViewer(optimistic)

    void task()
      .then((patch) => {
        if (patch !== null) applyViewer(patch)
      })
      .catch((reason: unknown) => {
        applyViewer(previous)
        setError(errorInfo(reason).detail)
      })
      .finally(() => {
        setPending(null)
      })
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
            <DitherImage src={profile.avatar} alt={`avatar of @${handle}`} fallback={initial} />
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

        <dl className="b-profile__counts">
          {counts.map((count) => (
            <div key={count.label} className="b-profile__count">
              <dt className="b-profile__count-label">{count.label}</dt>
              <dd className="b-profile__count-value">{count.value}</dd>
            </div>
          ))}
        </dl>

        {profile.createdAt !== null && profile.createdAt.length > 0 ? (
          <p className="b-profile__joined">joined {formatAbsoluteTime(profile.createdAt)}</p>
        ) : null}

        {labels.length > 0 ? (
          <div className="b-profile__labels">
            {labels.map((label) => (
              <Tag key={label} tone="warn" title={label}>
                {label}
              </Tag>
            ))}
          </div>
        ) : null}

        <fieldset className="b-profile__actions">
          <legend className="visually-hidden">profile actions</legend>
          <button
            type="button"
            className="b-post-card__action"
            data-kind="follow"
            aria-pressed={viewer.following !== null}
            disabled={toggling}
            title={error ?? undefined}
            onClick={() => {
              if (viewer.following !== null) {
                const followUri = viewer.following
                runAction(
                  'unfollow',
                  async () => {
                    await unfollow(followUri)
                    return { following: null }
                  },
                  null,
                )
                return
              }
              runAction(
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
            aria-pressed={viewer.muted}
            disabled={toggling}
            onClick={() => {
              if (viewer.muted) {
                runAction(
                  'unmute',
                  async () => {
                    await unmute(profile.did)
                    return { muted: false, mutedOnlyReposts: false, mutedOnlyQuoteposts: false }
                  },
                  { muted: false, mutedOnlyReposts: false, mutedOnlyQuoteposts: false },
                )
                return
              }
              runAction(
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
            className="b-post-card__action"
            data-kind="hide-reposts"
            aria-pressed={viewer.mutedOnlyReposts}
            disabled={toggling}
            onClick={() => {
              if (viewer.mutedOnlyReposts) {
                runAction(
                  'show-reposts',
                  async () => {
                    await showReposts(profile.did)
                    return { muted: false, mutedOnlyReposts: false, mutedOnlyQuoteposts: false }
                  },
                  { muted: false, mutedOnlyReposts: false, mutedOnlyQuoteposts: false },
                )
                return
              }
              runAction(
                'hide-reposts',
                async () => {
                  await hideReposts(profile.did)
                  return { muted: false, mutedOnlyReposts: true, mutedOnlyQuoteposts: false }
                },
                { muted: false, mutedOnlyReposts: true, mutedOnlyQuoteposts: false },
              )
            }}
          >
            {pending === 'hide-reposts'
              ? 'hiding reposts'
              : pending === 'show-reposts'
                ? 'showing reposts'
                : viewer.mutedOnlyReposts
                  ? 'show reposts'
                  : 'hide reposts'}
          </button>

          <button
            type="button"
            className="b-post-card__action b-post-card__action--danger"
            data-kind="block"
            aria-pressed={viewer.blocking !== null}
            disabled={toggling}
            onClick={() => {
              if (viewer.blocking !== null) {
                const blockUri = viewer.blocking
                runAction(
                  'unblock',
                  async () => {
                    await unblock(blockUri)
                    return { blocking: null }
                  },
                  { blocking: null },
                )
                return
              }
              runAction(
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

          <button
            type="button"
            className="b-post-card__action"
            data-kind="notify-post"
            aria-pressed={viewer.activitySubscription?.post === true}
            disabled={toggling}
            onClick={() => {
              const current = viewer.activitySubscription
              const next = { post: !(current?.post ?? false), reply: current?.reply ?? false }
              runAction(
                'notify-post',
                async () => {
                  const result = await setActivitySubscription(profile.did, next)
                  return { activitySubscription: result }
                },
                { activitySubscription: next },
              )
            }}
          >
            {viewer.activitySubscription?.post === true ? 'notify posts on' : 'notify posts'}
          </button>

          <button
            type="button"
            className="b-post-card__action"
            data-kind="notify-reply"
            aria-pressed={viewer.activitySubscription?.reply === true}
            disabled={toggling}
            onClick={() => {
              const current = viewer.activitySubscription
              const next = { post: current?.post ?? false, reply: !(current?.reply ?? false) }
              runAction(
                'notify-reply',
                async () => {
                  const result = await setActivitySubscription(profile.did, next)
                  return { activitySubscription: result }
                },
                { activitySubscription: next },
              )
            }}
          >
            {viewer.activitySubscription?.reply === true ? 'notify replies on' : 'notify replies'}
          </button>
        </fieldset>

        {error !== null ? (
          <p className="b-profile__action-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Frame>
  )
}
