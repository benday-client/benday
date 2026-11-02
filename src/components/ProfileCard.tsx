import { useQueryClient } from '@tanstack/react-query'
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuthStore } from '../lib/auth'
import { focusOwningDeck } from '../lib/deckFocus'
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
import type { ProfileActivitySubscription, ProfileModel, ProfileViewerState } from '../lib/types'
import { useUiStore } from '../lib/ui'
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

type ProfileAction =
  | 'follow'
  | 'unfollow'
  | 'mute'
  | 'unmute'
  | 'hide-reposts'
  | 'show-reposts'
  | 'block'
  | 'unblock'
  | 'notify'

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

interface NotifyChoice {
  key: string
  label: string
  post: boolean
  reply: boolean
}

const NOTIFY_CHOICES: NotifyChoice[] = [
  { key: 'all', label: 'all activity', post: true, reply: true },
  { key: 'posts', label: 'new posts only', post: true, reply: false },
  { key: 'replies', label: 'replies only', post: false, reply: true },
  { key: 'off', label: 'off', post: false, reply: false },
]

function notifyChoice(subscription: ProfileActivitySubscription | null): string {
  if (subscription === null) return 'off'
  if (subscription.post) return subscription.reply ? 'all' : 'posts'
  if (subscription.reply) return 'replies'
  return 'off'
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
  if ('activitySubscription' in optimistic) {
    patch.activitySubscription = previous.activitySubscription
  }
  return patch
}

interface NotifyPickerProps {
  value: string
  disabled: boolean
  locked: boolean
  onLocked: () => void
  onSelect: (key: string) => void
}

interface MenuPlacement {
  top?: number
  bottom?: number
  left: number
  width: number
}

function NotifyPicker({ value, disabled, locked, onLocked, onSelect }: NotifyPickerProps) {
  const listId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [placement, setPlacement] = useState<MenuPlacement | null>(null)
  const selectedIndex = Math.max(
    0,
    NOTIFY_CHOICES.findIndex((choice) => choice.key === value),
  )
  const selected = NOTIFY_CHOICES[selectedIndex] ?? NOTIFY_CHOICES[0]

  const close = (restoreFocus = false) => {
    const active = document.activeElement
    const focusInMenu = active instanceof Node && menuRef.current?.contains(active) === true
    setOpen(false)
    // only reclaim focus the menu actually held; a newly focused control keeps it
    if (restoreFocus && focusInMenu) triggerRef.current?.focus()
  }

  const openPicker = () => {
    if (disabled) return
    if (locked) {
      onLocked()
      return
    }
    const trigger = triggerRef.current
    if (trigger === null) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.max(rect.width, 192)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    const spaceBelow = window.innerHeight - rect.bottom
    setPlacement(
      spaceBelow < 140
        ? { bottom: window.innerHeight - rect.top + 4, left, width }
        : { top: rect.bottom + 4, left, width },
    )
    setActive(selectedIndex)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return

    const frame = window.requestAnimationFrame(() => {
      optionRefs.current[active]?.focus()
    })
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (wrapperRef.current?.contains(event.target) === true) return
      if (menuRef.current?.contains(event.target) === true) return
      setOpen(false)
    }
    const closeOnViewportChange = (event: Event) => {
      // scrolling the portalled menu itself must not dismiss it
      if (event.target instanceof Node && menuRef.current?.contains(event.target) === true) return
      const active = document.activeElement
      const focusInMenu = active instanceof Node && menuRef.current?.contains(active) === true
      setOpen(false)
      // the menu owned focus: give it back to its opener instead of dropping
      // the reader onto the document
      if (focusInMenu) triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [open, active])

  const choose = (key: string) => {
    const active = document.activeElement
    const focusInMenu = active instanceof Node && menuRef.current?.contains(active) === true
    // the action about to run disables this picker; move focus to the trigger
    // first so the card can hand it to its deck instead of losing it
    if (focusInMenu) triggerRef.current?.focus()
    onSelect(key)
    setOpen(false)
  }

  const handleOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
    key: string,
  ) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      const next =
        (index + (event.key === 'ArrowDown' ? 1 : -1) + NOTIFY_CHOICES.length) %
        NOTIFY_CHOICES.length
      setActive(next)
      optionRefs.current[next]?.focus()
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      const next = event.key === 'Home' ? 0 : NOTIFY_CHOICES.length - 1
      setActive(next)
      optionRefs.current[next]?.focus()
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      choose(key)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }

    if (event.key === 'Tab') {
      close(true)
    }
  }

  return (
    <div className="b-profile__notify" ref={wrapperRef}>
      <span className="b-profile__notify-label">notifications</span>
      <div className="b-profile__notify-control">
        <button
          ref={triggerRef}
          type="button"
          className="b-profile__notify-select"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={`notifications, ${selected?.label ?? 'off'}`}
          disabled={disabled}
          onClick={() => {
            if (open) {
              close(true)
              return
            }
            openPicker()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault()
            openPicker()
          }}
        >
          <span>{selected?.label ?? 'off'}</span>
          <span className="b-profile__notify-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {open && placement !== null
          ? createPortal(
              <div
                ref={menuRef}
                id={listId}
                className="b-profile__notify-menu"
                role="listbox"
                aria-label="notifications"
                style={{
                  top: placement.top,
                  bottom: placement.bottom,
                  left: placement.left,
                  width: placement.width,
                }}
              >
                {NOTIFY_CHOICES.map((choice, index) => (
                  <div key={choice.key} role="none">
                    <button
                      ref={(element) => {
                        optionRefs.current[index] = element
                      }}
                      type="button"
                      role="option"
                      className="b-profile__notify-option"
                      data-active={index === active ? 'true' : undefined}
                      aria-selected={choice.key === value}
                      tabIndex={index === active ? 0 : -1}
                      onFocus={() => {
                        setActive(index)
                      }}
                      onClick={() => {
                        choose(choice.key)
                      }}
                      onKeyDown={(event) => {
                        handleOptionKeyDown(event, index, choice.key)
                      }}
                    >
                      {choice.label}
                    </button>
                  </div>
                ))}
              </div>,
              document.body,
            )
          : null}
      </div>
    </div>
  )
}

export function ProfileCard({ profile }: ProfileCardProps) {
  const queryClient = useQueryClient()
  const openDialog = useUiStore((state) => state.openDialog)
  const actionsRef = useRef<HTMLFieldSetElement>(null)
  const [pending, setPending] = useState<ProfileAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handle = profile.handle.length > 0 ? profile.handle : 'unknown'
  const displayName = profile.displayName.length > 0 ? profile.displayName : handle
  const viewer = profile.viewer
  const signedInDid = useAuthStore((state) => state.account?.did ?? null)
  const authenticated = useAuthStore((state) => state.status === 'authenticated')
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
    viewer.muted ? 'muted' : null,
    viewer.mutedOnlyReposts ? 'reposts hidden' : null,
    viewer.mutedOnlyQuoteposts ? 'quoteposts hidden' : null,
    viewer.blocking !== null ? 'blocked' : viewer.blockedBy ? 'blocked by' : null,
  ].filter((note): note is string => note !== null)

  const applyViewer = (patch: Partial<ProfileViewerState>, identity: ProfileIdentity) => {
    // cross-host patches for the same account stay; another viewer or another
    // profile's cache entry never receives this state
    queryClient.setQueriesData<ProfileModel>(
      {
        predicate: (query) =>
          query.queryKey[0] === 'profile' && query.queryKey[3] === identity.viewerDid,
      },
      (current) => {
        if (current === undefined || current.did !== identity.profileDid) return current
        return { ...current, viewer: { ...current.viewer, ...patch } }
      },
    )
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

    const captured = identityRef.current
    const previous = profile.viewer
    // every action disables the toolbar while it runs; move the keyboard to
    // the owning deck before the focused control becomes unreachable
    focusOwningDeck(actionsRef.current)
    setPending(action)
    setError(null)
    if (optimistic !== null) applyViewer(optimistic, captured)

    const owns = () =>
      identityRef.current.viewerDid === captured.viewerDid &&
      identityRef.current.profileDid === captured.profileDid

    void task()
      .then((patch) => {
        if (patch !== null && owns()) applyViewer(patch, captured)
      })
      .catch((reason: unknown) => {
        if (!owns()) return
        const rollback = rollbackViewer(optimistic, previous)
        if (rollback !== null) applyViewer(rollback, captured)
        setError(errorInfo(reason).detail)
      })
      .finally(() => {
        if (owns()) setPending(null)
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
              data-active={viewer.muted ? 'true' : 'false'}
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

            {/* a repost-only mute must never replace a full mute with a weaker scope,
                and a quote-only hide leaves the repost toggle disabled */}
            <button
              type="button"
              className="b-post-card__action"
              data-kind="hide-reposts"
              data-active={viewer.mutedOnlyReposts ? 'true' : 'false'}
              disabled={
                toggling || viewer.muted || (viewer.mutedOnlyQuoteposts && !viewer.mutedOnlyReposts)
              }
              title={
                viewer.muted
                  ? 'unmute first'
                  : viewer.mutedOnlyQuoteposts
                    ? 'quoteposts hidden'
                    : undefined
              }
              onClick={() => {
                if (viewer.mutedOnlyReposts) {
                  const keepQuoteposts = viewer.mutedOnlyQuoteposts
                  const scope = {
                    muted: false,
                    mutedOnlyReposts: false,
                    mutedOnlyQuoteposts: keepQuoteposts,
                  }
                  runAction(
                    'show-reposts',
                    async () => {
                      await showReposts(profile.did, keepQuoteposts)
                      return scope
                    },
                    scope,
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
              data-active={viewer.blocking !== null ? 'true' : 'false'}
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

            <NotifyPicker
              value={notifyChoice(viewer.activitySubscription)}
              disabled={toggling}
              locked={!authenticated}
              onLocked={() => {
                openDialog('login')
              }}
              onSelect={(key) => {
                const choice = NOTIFY_CHOICES.find((entry) => entry.key === key)
                if (choice === undefined) return
                const next = { post: choice.post, reply: choice.reply }
                runAction(
                  'notify',
                  async () => {
                    const result = await setActivitySubscription(profile.did, next)
                    return { activitySubscription: result }
                  },
                  { activitySubscription: next },
                )
              }}
            />
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
