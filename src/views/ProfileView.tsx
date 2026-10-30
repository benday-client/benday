import { useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { Deck } from '../components/Deck'
import { PostCard } from '../components/PostCard'
import { ProfileCard } from '../components/ProfileCard'
import {
  PROFILE_MODES,
  type ProfileMode,
  ProfileModeBack,
  ProfileModeCard,
  ProfileModePeek,
  profileModeName,
} from '../components/ProfileModeCard'
import { RefreshCard } from '../components/RefreshCard'
import { EmptyState, ErrorNotice, Frame, Progress } from '../components/ui'
import { usePostFeed, useProfile } from '../hooks/useBskyQueries'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useViewerSync } from '../hooks/useViewerSync'
import { errorInfo } from '../lib/errors'
import type { PostModel } from '../lib/types'
import { useUiStore } from '../lib/ui'

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

const MODE_EMPTY: Record<ProfileMode, { title: string; hint: string }> = {
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

export default function ProfileView() {
  const [, navigate] = useLocation()
  const params = useParams<{ actor?: string }>()
  const actor = decodeActor(params.actor ?? '')
  const openPost = useUiStore((state) => state.openPost)
  const profile = useProfile(actor)
  const feed = usePostFeed({ kind: 'author', actor })
  const posts = feed.data ?? []
  useViewerSync(posts)
  const wide = useMediaQuery('(min-width: 900px)')
  const [mode, setMode] = useState<ProfileMode>('posts')
  const [modeDeck, setModeDeck] = useState(false)
  const [dealMode, setDealMode] = useState<'modes' | 'posts' | null>(null)
  const dealTimerRef = useRef<number | null>(null)

  const profileInfo = profile.error !== null ? errorInfo(profile.error) : null
  const feedInfo = feed.error !== null ? errorInfo(feed.error) : null
  const handle = actor.replace(/^@/, '')
  const authorDid = profile.data?.did ?? null
  const hiddenReposts = profile.data?.viewer.mutedOnlyReposts === true
  const entries = hiddenReposts ? posts.filter((post) => post.reason?.type !== 'repost') : posts

  const modeEntries = (candidate: ProfileMode): PostModel[] => {
    if (candidate === 'posts') return entries.filter((post) => !post.isReply)
    if (candidate === 'replies') {
      return entries.filter(
        (post) => post.isReply && (authorDid === null || post.author.did === authorDid),
      )
    }
    return entries.filter(hasMedia)
  }

  const visiblePosts = modeEntries(mode)
  const modeCounts: Record<ProfileMode, number> = {
    posts: modeEntries('posts').length,
    replies: modeEntries('replies').length,
    media: modeEntries('media').length,
  }

  const playDeal = (next: 'modes' | 'posts') => {
    setDealMode(next)
    if (dealTimerRef.current !== null) window.clearTimeout(dealTimerRef.current)
    dealTimerRef.current = window.setTimeout(() => {
      setDealMode(null)
      dealTimerRef.current = null
    }, 900)
  }

  const switchModeDeck = (next: boolean) => {
    setModeDeck(next)
    playDeal(next ? 'modes' : 'posts')
  }

  const chooseMode = (next: ProfileMode) => {
    setMode(next)
    setModeDeck(false)
    playDeal('posts')
  }

  useEffect(() => {
    return () => {
      if (dealTimerRef.current !== null) window.clearTimeout(dealTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!wide) setModeDeck(false)
  }, [wide])

  useEffect(() => {
    if (!modeDeck) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return
      const ui = useUiStore.getState()
      if (ui.dialog !== null || ui.compose !== null) return
      event.preventDefault()
      switchModeDeck(false)
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [modeDeck])

  const modeIndex = Math.max(
    0,
    PROFILE_MODES.findIndex((option) => option.mode === mode),
  )
  const empty = MODE_EMPTY[mode]
  const feedEmpty =
    feedInfo !== null ? (
      <ErrorNotice title={feedInfo.title} message={feedInfo.detail} onRetry={feed.retry} />
    ) : (
      <EmptyState title={empty.title} hint={empty.hint} />
    )

  return (
    <section className="b-view">
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
        ) : (
          <>
            <div className="b-view__profile">
              {profileInfo !== null ? (
                <ErrorNotice
                  title={profileInfo.title}
                  message={profileInfo.detail}
                  onRetry={profile.retry}
                />
              ) : profile.data !== null ? (
                <ProfileCard profile={profile.data} />
              ) : (
                <Frame label="identity" meta={`@${handle}`}>
                  <p className="mono-label">resolving identity</p>
                  <Progress indeterminate />
                </Frame>
              )}
            </div>
            <div className="b-profile-feed">
              {modeDeck && wide ? (
                <div className="b-deck-stage" data-deal={dealMode === 'modes' ? 'true' : undefined}>
                  <Deck
                    key="profile-modes"
                    items={PROFILE_MODES}
                    getKey={(option) => option.mode}
                    renderItem={(option) => (
                      <ProfileModeCard
                        option={option}
                        active={option.mode === mode}
                        count={modeCounts[option.mode]}
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
                      <ProfileModeBack handle={handle} onClose={() => switchModeDeck(false)} />
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
                    key={`profile-feed:${mode}`}
                    items={visiblePosts}
                    getKey={(post) => post.uri}
                    renderItem={(post, index, focused) => (
                      <PostCard post={post} index={index} focused={focused} />
                    )}
                    onActivate={(post) => {
                      openPost(post)
                      navigate(`/thread?uri=${encodeURIComponent(post.uri)}`)
                    }}
                    {...(wide
                      ? {
                          onExitStart: () => {
                            switchModeDeck(true)
                          },
                          leadingPeek: (
                            <ProfileModePeek
                              mode={mode}
                              count={visiblePosts.length}
                              onOpen={() => {
                                switchModeDeck(true)
                              }}
                            />
                          ),
                          leadingPeekInteractive: true,
                        }
                      : {})}
                    pending={feed.isPending}
                    hasMore={feed.hasMore}
                    loadingMore={feed.isLoadingMore}
                    loadMoreError={feed.loadMoreError}
                    onLoadMore={feed.loadMore}
                    onRetryLoadMore={feed.retryLoadMore}
                    footer={
                      <RefreshCard
                        label={`refresh ${profileModeName(mode)}`}
                        refreshing={feed.isFetching}
                        onRefresh={feed.retry}
                      />
                    }
                    label={`${profileModeName(mode)} by ${actor}`}
                    empty={feedEmpty}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
