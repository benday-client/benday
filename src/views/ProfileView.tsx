import { useLocation, useParams } from 'wouter'
import { Deck } from '../components/Deck'
import { PostCard } from '../components/PostCard'
import { ProfileCard } from '../components/ProfileCard'
import { EmptyState, ErrorNotice, Frame, Progress } from '../components/ui'
import { usePostFeed, useProfile } from '../hooks/useBskyQueries'
import { useViewerSync } from '../hooks/useViewerSync'
import { errorInfo } from '../lib/errors'

function decodeActor(raw: string): string {
  try {
    return decodeURIComponent(raw).trim()
  } catch {
    return raw.trim()
  }
}

export default function ProfileView() {
  const [, navigate] = useLocation()
  const params = useParams<{ actor?: string }>()
  const actor = decodeActor(params.actor ?? '')
  const profile = useProfile(actor)
  const feed = usePostFeed({ kind: 'author', actor })
  const posts = feed.data ?? []
  useViewerSync(posts)
  const profileInfo = profile.error !== null ? errorInfo(profile.error) : null
  const feedInfo = feed.error !== null ? errorInfo(feed.error) : null
  const handle = actor.replace(/^@/, '')

  return (
    <section className="b-view">
      <h1 className="visually-hidden">profile</h1>
      <div className="b-view__body">
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
            {feedInfo !== null && posts.length === 0 ? (
              <ErrorNotice title={feedInfo.title} message={feedInfo.detail} onRetry={feed.retry} />
            ) : (
              <Deck
                items={posts}
                getKey={(post) => post.uri}
                renderItem={(post, index, focused) => (
                  <PostCard post={post} index={index} focused={focused} />
                )}
                onActivate={(post) => navigate(`/thread?uri=${encodeURIComponent(post.uri)}`)}
                pending={feed.isPending}
                hasMore={feed.hasMore}
                loadingMore={feed.isLoadingMore}
                onLoadMore={feed.loadMore}
                label={`posts by ${actor}`}
                empty={
                  <EmptyState title="no posts" hint="this actor has no posts in the appview" />
                }
              />
            )}
          </>
        )}
      </div>
    </section>
  )
}
