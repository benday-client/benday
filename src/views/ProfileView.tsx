import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { Deck } from '../components/Deck'
import { PostCard } from '../components/PostCard'
import { ProfileCard } from '../components/ProfileCard'
import { RefreshCard } from '../components/RefreshCard'
import {
  Button,
  CardBackButton,
  cardBackIndex,
  EmptyState,
  ErrorNotice,
  Frame,
  ModeCard,
  Progress,
} from '../components/ui'
import { usePostFeed, useProfile } from '../hooks/useBskyQueries'
import { useDealFlash } from '../hooks/useDealFlash'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useRetainedError } from '../hooks/useRetainedError'
import { useViewerSync } from '../hooks/useViewerSync'
import { useAuthStore } from '../lib/auth'
import { focusDeckAfterSwap } from '../lib/deckFocus'
import { errorInfo } from '../lib/errors'
import {
  cardCountLabel,
  PROFILE_MODES,
  type ProfileContentMode,
  type ProfileMode,
  profileModeName,
} from '../lib/profileModes'
import type { PostModel } from '../lib/types'
import { uiOwnsKeyboard, useUiStore } from '../lib/ui'

function decodeActor(raw: string): string {
  try {
    return decodeURIComponent(raw).trim()
  } catch {
    return raw.trim()
  }
}

function hasMedia(post: PostModel): boolean {
  const embed = post.embed
  if (embed === null) return false
  if (embed.type === 'images' || embed.type === 'video') return true
  if (embed.type === 'recordWithMedia') {
    return embed.media.type === 'images' || embed.media.type === 'video'
  }
  return false
}

const MODE_EMPTY: Record<ProfileContentMode, { title: string; hint: string }> = {
  posts: {
    title: 'no posts',
    hint: 'this actor has no standalone posts in the appview',
  },
  replies: {
    title: 'no replies',
    hint: 'this actor has not answered anyone in the fetched feed',
  },
  media: {
    title: 'no media',
    hint: 'this actor has no image or video posts in the fetched feed',
  },
}

type ProfileDeckItem =
  | { kind: 'profile' }
  | { kind: 'post'; post: PostModel }
  | { kind: 'loading' }
  | { kind: 'status' }
  | { kind: 'refresh' }

export default function ProfileView() {
  const [, navigate] = useLocation()
  const params = useParams<{ actor?: string }>()
  const actor = decodeActor(params.actor ?? '')
  const openPost = useUiStore((state) => state.openPost)
  const openThread = useCallback(
    (post: PostModel) => {
      openPost(post)
      navigate(`/thread?uri=${encodeURIComponent(post.uri)}`)
    },
    [navigate, openPost],
  )
  const viewerDid = useAuthStore((state) => state.account?.did ?? null)
  const profile = useProfile(actor)
  const feed = usePostFeed({ kind: 'author', actor })
  const posts = feed.data ?? []
  useViewerSync(posts)
  const wide = useMediaQuery('(min-width: 900px)')
  const [mode, setMode] = useState<ProfileMode>('profile')
  const [modeDeck, setModeDeck] = useState(false)
  const [dealMode, playDeal] = useDealFlash<'modes' | 'posts'>()
  const viewRef = useRef<HTMLElement>(null)
  const focusSwapRef = useRef<(() => void) | null>(null)

  const profileDeckKey = JSON.stringify(['profile-deck', actor, mode, viewerDid ?? 'anonymous'])
  // the request a failure belongs to; a different actor, host or viewer is a
  // different request and never inherits an older notice
  const requestIdentity = JSON.stringify([actor, viewerDid ?? 'anonymous'])

  const requestDeckFocus = () => {
    focusSwapRef.current?.()
    focusSwapRef.current = focusDeckAfterSwap(viewRef.current)
  }

  // a different actor, host or viewer is a different request; the hook drops
  // the capture instead of letting an older notice carry over
  const profileFailure = useRetainedError(
    requestIdentity,
    profile.data !== null,
    profile.error ?? null,
    profile.isFetching,
  )
  const feedFailure = useRetainedError(
    requestIdentity,
    posts.length > 0,
    feed.error ?? null,
    feed.isFetching,
  )
  const profileInfo = profileFailure.error === null ? null : errorInfo(profileFailure.error)
  const feedInfo = feedFailure.error === null ? null : errorInfo(feedFailure.error)

  const retryProfile = () => {
    profileFailure.retry(profile.retry)
  }
  const retryFeed = () => {
    feedFailure.retry(feed.retry)
  }
  const handle = actor.replace(/^@/, '')
  const authorDid = profile.data?.did ?? null
  const hiddenReposts = profile.data?.viewer.mutedOnlyReposts === true
  const entries = hiddenReposts ? posts.filter((post) => post.reason?.type !== 'repost') : posts

  const modeEntries = (candidate: ProfileContentMode): PostModel[] => {
    if (candidate === 'posts') return entries.filter((post) => !post.isReply)
    if (candidate === 'replies') {
      return entries.filter(
        (post) => post.isReply && (authorDid === null || post.author.did === authorDid),
      )
    }
    return entries.filter(hasMedia)
  }

  const visiblePosts = mode === 'profile' ? [] : modeEntries(mode)
  const emptyForMode = mode === 'profile' ? null : MODE_EMPTY[mode]
  const modeCounts: Record<ProfileContentMode, number> = {
    posts: modeEntries('posts').length,
    replies: modeEntries('replies').length,
    media: modeEntries('media').length,
  }

  const switchModeDeck = (next: boolean) => {
    setModeDeck(next)
    playDeal(next ? 'modes' : 'posts')
    requestDeckFocus()
  }

  const chooseMode = (next: ProfileMode) => {
    const hadChooser = modeDeck
    setMode(next)
    setModeDeck(false)
    playDeal('posts')
    // a mode picked from the chooser swaps the content deck; the pinned row on
    // narrow widths leaves focus where the reader put it
    if (hadChooser) requestDeckFocus()
  }

  useEffect(() => {
    return () => {
      focusSwapRef.current?.()
    }
  }, [])

  useEffect(() => {
    if (!wide) setModeDeck(false)
  }, [wide])

  useEffect(() => {
    if (!modeDeck) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return
      if (uiOwnsKeyboard()) return
      // an open native modal keeps Escape for itself
      if (document.querySelector('dialog[open]') !== null) return
      event.preventDefault()
      switchModeDeck(false)
    }

    // capture phase so the switcher closes before the app's bubble-phase
    // Escape handling can navigate away from the profile
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [modeDeck])

  const modeIndex = Math.max(
    0,
    PROFILE_MODES.findIndex((option) => option.mode === mode),
  )

  let feedStatus: ReactNode = null
  if (emptyForMode !== null) {
    feedStatus =
      feedInfo !== null ? (
        <ErrorNotice
          title={feedInfo.title}
          message={feedInfo.detail}
          onRetry={retryFeed}
          retrying={feed.isFetching}
        />
      ) : (
        <EmptyState
          title={emptyForMode.title}
          hint={emptyForMode.hint}
          action={
            <Button variant="ghost" onClick={feed.retry}>
              reload
            </Button>
          }
        />
      )
  }

  const loadedProfile = profile.data
  const deckItems: ProfileDeckItem[] = []
  if (mode === 'profile') {
    deckItems.push({ kind: 'profile' })
  } else {
    for (const post of visiblePosts) deckItems.push({ kind: 'post', post })
    // a blank first page has nothing to refresh yet; it only reports its load
    const firstPagePending = visiblePosts.length === 0 && feed.isPending && feedInfo === null
    if (visiblePosts.length === 0) {
      deckItems.push(firstPagePending ? { kind: 'loading' } : { kind: 'status' })
    }
    // explicit refresh stays the last card of every content deck
    if (!firstPagePending) deckItems.push({ kind: 'refresh' })
  }

  const deckExtras =
    mode === 'profile'
      ? {}
      : {
          hasMore: feed.hasMore,
          loadingMore: feed.isLoadingMore,
          loadMoreError: feed.loadMoreError,
          onLoadMore: feed.loadMore,
          onRetryLoadMore: feed.retryLoadMore,
        }

  return (
    <section className="b-view" ref={viewRef}>
      <h1 className="visually-hidden">profile</h1>
      {!wide && actor.length > 0 ? (
        <div className="b-view__tools b-view__tools--profile">
          <fieldset className="b-view__pinned">
            <legend className="mono-label">profile</legend>
            {PROFILE_MODES.map((option) => (
              <button
                key={option.mode}
                type="button"
                className="b-pinned-feed"
                data-active={option.mode === mode ? 'true' : 'false'}
                aria-pressed={option.mode === mode}
                onClick={() => {
                  chooseMode(option.mode)
                }}
              >
                {option.name}
              </button>
            ))}
          </fieldset>
        </div>
      ) : null}
      <div className="b-view__body b-view__body--profile">
        {actor.length === 0 ? (
          <EmptyState title="no profile selected" hint="open a card or name a handle to resolve" />
        ) : profileInfo !== null ? (
          <div className="b-view__profile">
            <ErrorNotice
              title={profileInfo.title}
              message={profileInfo.detail}
              onRetry={retryProfile}
              retrying={profile.isFetching}
            />
          </div>
        ) : loadedProfile === null ? (
          <div className="b-view__profile">
            <Frame label="identity" meta={`@${handle}`}>
              <Progress indeterminate label="resolving identity" />
            </Frame>
          </div>
        ) : (
          <div className="b-profile-feed">
            {modeDeck && wide ? (
              <div className="b-deck-stage" data-deal={dealMode === 'modes' ? 'true' : undefined}>
                <Deck
                  key={`profile-modes:${actor}:${mode}`}
                  items={PROFILE_MODES}
                  getKey={(option) => option.mode}
                  renderItem={(option) => (
                    <ModeCard
                      label="mode"
                      name={option.name}
                      description={option.description}
                      active={option.mode === mode}
                      countLabel={
                        option.mode === 'profile' ? null : cardCountLabel(modeCounts[option.mode])
                      }
                      activeHint="current"
                      onSelect={() => {
                        chooseMode(option.mode)
                      }}
                    />
                  )}
                  onActivate={(option) => {
                    chooseMode(option.mode)
                  }}
                  onExitStart={() => {
                    switchModeDeck(false)
                  }}
                  leadingPeek={
                    <CardBackButton
                      label="card back"
                      index="↩"
                      title="profile"
                      detail={`@${handle}`}
                      hint="← profile"
                      ariaLabel="back to profile"
                      onClick={() => {
                        switchModeDeck(false)
                      }}
                    />
                  }
                  leadingPeekInteractive
                  initialIndex={modeIndex}
                  label="profile modes"
                />
              </div>
            ) : (
              <div
                className="b-deck-stage b-deck-stage--profile"
                data-deal={dealMode === 'posts' ? 'true' : undefined}
              >
                <Deck
                  key={profileDeckKey}
                  stateKey={profileDeckKey}
                  pending={feed.isPending && visiblePosts.length === 0 && feedInfo === null}
                  items={deckItems}
                  getKey={(item) =>
                    item.kind === 'profile'
                      ? 'profile'
                      : item.kind === 'post'
                        ? item.post.uri
                        : item.kind
                  }
                  renderItem={(item, index, focused) => {
                    if (item.kind === 'profile') return <ProfileCard profile={loadedProfile} />
                    if (item.kind === 'loading') {
                      return (
                        <Frame label="posts">
                          <Progress indeterminate label="loading posts" />
                        </Frame>
                      )
                    }
                    if (item.kind === 'status') return feedStatus
                    if (item.kind === 'refresh') {
                      return (
                        <RefreshCard
                          index={index}
                          focused={focused}
                          refreshing={feed.isFetching}
                          label={`refresh ${profileModeName(mode)}`}
                          onRefresh={() => {
                            if (!feed.isFetching) feed.retry()
                          }}
                        />
                      )
                    }
                    return (
                      <PostCard
                        post={item.post}
                        index={index}
                        focused={focused}
                        onOpen={openThread}
                      />
                    )
                  }}
                  onActivate={(item) => {
                    if (item.kind === 'post') {
                      openThread(item.post)
                      return
                    }
                    // an already running refresh must not restart the deck
                    if (item.kind === 'refresh' && !feed.isFetching) feed.retry()
                  }}
                  {...(wide
                    ? {
                        onExitStart: () => {
                          switchModeDeck(true)
                        },
                        leadingPeek: (
                          <CardBackButton
                            label="modes"
                            meta={profileModeName(mode)}
                            index={cardBackIndex(mode === 'profile' ? 1 : visiblePosts.length)}
                            title={profileModeName(mode)}
                            detail={cardCountLabel(mode === 'profile' ? 1 : visiblePosts.length)}
                            hint="← modes"
                            ariaLabel={`change mode, ${profileModeName(mode)}`}
                            onClick={() => {
                              switchModeDeck(true)
                            }}
                          />
                        ),
                        leadingPeekInteractive: true,
                      }
                    : {})}
                  {...deckExtras}
                  label={
                    mode === 'profile'
                      ? `profile of ${actor}`
                      : `${profileModeName(mode)} by ${actor}`
                  }
                />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
