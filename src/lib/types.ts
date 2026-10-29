export type Theme = 'void' | 'bone'

export type FlowPreference = 'auto' | 'horizontal' | 'vertical'

export type AppViewKind = 'official' | 'community' | 'custom'

export interface AppViewCapabilities {
  search: boolean
  feeds: boolean
}

export interface AppViewTarget {
  id: string
  label: string
  host: string
  kind: AppViewKind
  note: string
}

export interface AppViewPreset extends AppViewTarget {
  capabilities: AppViewCapabilities
}

export interface AuthorModel {
  did: string
  handle: string
  displayName: string
  avatar: string | null
}

export type FacetFeature =
  | { kind: 'mention'; did: string; handle: string }
  | { kind: 'link'; uri: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'unknown'; typeName: string }

export interface FacetSpan {
  start: number
  end: number
  feature: FacetFeature
}

export interface ImageModel {
  thumb: string
  fullsize: string
  alt: string
  width: number | null
  height: number | null
}

export interface ImageEmbed {
  type: 'images'
  images: ImageModel[]
}

export interface ExternalEmbed {
  type: 'external'
  uri: string
  title: string
  description: string
  thumb: string | null
  domain: string
}

export interface QuotedPostModel {
  uri: string
  cid: string
  author: AuthorModel
  text: string
  facets: FacetSpan[]
  indexedAt: string
  embedType: string | null
}

export interface QuoteEmbed {
  type: 'quote'
  post: QuotedPostModel
}

export interface VideoEmbed {
  type: 'video'
  thumbnail: string | null
  alt: string
  playlist: string | null
}

export interface UnknownEmbed {
  type: 'unknown'
  typeName: string
}

export type EmbedModel = ImageEmbed | ExternalEmbed | QuoteEmbed | VideoEmbed | UnknownEmbed

export type PostReason = { type: 'repost'; by: AuthorModel } | { type: 'pin' }

export interface PostModel {
  uri: string
  cid: string
  author: AuthorModel
  text: string
  facets: FacetSpan[]
  indexedAt: string
  replyCount: number
  repostCount: number
  likeCount: number
  quoteCount: number
  embed: EmbedModel | null
  reason: PostReason | null
  isReply: boolean
  labels: string[]
}

export interface ProfileModel {
  did: string
  handle: string
  displayName: string
  description: string
  avatar: string | null
  banner: string | null
  followersCount: number
  followsCount: number
  postsCount: number
  createdAt: string | null
  labels: string[]
}

export interface ThreadEntry {
  post: PostModel
  depth: number
  role: 'ancestor' | 'focus' | 'reply'
}

export interface ThreadModel {
  focusUri: string
  entries: ThreadEntry[]
}

export interface QueryState<T> {
  data: T | null
  isPending: boolean
  isFetching: boolean
  error: Error | null
  retry: () => void
}

export interface PostFeedState extends QueryState<PostModel[]> {
  hasMore: boolean
  isLoadingMore: boolean
  loadMore: () => void
}

export type FeedSource =
  | { kind: 'discover' }
  | { kind: 'author'; actor: string }
  | { kind: 'search'; query: string }
  | { kind: 'feed'; uri: string }
