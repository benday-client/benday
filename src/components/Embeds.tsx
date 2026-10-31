import { Link, useLocation } from 'wouter'
import type {
  EmbedModel,
  ExternalEmbed,
  ImageModel,
  MediaEmbed,
  QuotedPostModel,
  RecordWithMediaEmbed,
  UnavailableEmbed,
  UnknownEmbed,
  VideoEmbed,
} from '../lib/types'
import { DitherImage } from './DitherImage'
import { FacetText } from './FacetText'
import { Kbd, Tag } from './ui'
import { VideoPlayer } from './VideoPlayer'

export interface EmbedsProps {
  embed: EmbedModel
  /** hides media from pointer, focus and assistive tech until it is revealed */
  concealed?: boolean
}

function concealment(concealed: boolean): { inert?: boolean; 'aria-hidden'?: true } {
  return concealed ? { inert: true, 'aria-hidden': true } : {}
}

function safeExternalUrl(uri: string): string | null {
  if (uri.length === 0) return null
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return uri
}

const BLOCK_PAGE_MARKERS = [
  'user-agent',
  'user agent',
  'captcha',
  'access denied',
  'forbidden',
  'just a moment',
  'attention required',
  'are you a robot',
  'request blocked',
  'too many requests',
]

function looksLikeBlockPage(text: string): boolean {
  const lower = text.toLowerCase()
  return BLOCK_PAGE_MARKERS.some((marker) => lower.includes(marker))
}

function externalAddress(uri: string, domain: string): string {
  try {
    const parsed = new URL(uri)
    const path = decodeURIComponent(parsed.pathname).replace(/\/+$/, '')
    return `${parsed.host}${path}`
  } catch {
    return domain
  }
}

function ImageGrid({ images, concealed }: { images: readonly ImageModel[]; concealed: boolean }) {
  if (images.length === 0) return null
  const single = images.length === 1

  return (
    <figure className="b-embed b-embed--images" {...concealment(concealed)}>
      <div className="b-embed__grid" data-count={String(images.length)}>
        {images.map((image, index) => {
          const alt = image.alt.length > 0 ? image.alt : `image ${index + 1} of ${images.length}`
          const href = safeExternalUrl(image.fullsize)
          const titleProps = image.alt.length > 0 ? { title: image.alt } : {}
          const content = (
            <>
              <span className="b-embed__image-frame">
                <DitherImage
                  // the grid shows the cheap thumbnail and falls back to the
                  // full size only when the appview omitted one
                  src={image.thumb.length > 0 ? image.thumb : image.fullsize || null}
                  alt={alt}
                  loading="lazy"
                  {...(single ? { width: image.width, height: image.height } : {})}
                />
              </span>
              {single && image.alt.length > 0 ? (
                <span className="b-embed__caption">{image.alt}</span>
              ) : null}
            </>
          )
          const key = `${image.fullsize}:${image.alt}`

          if (href === null) {
            return (
              <div key={key} className="b-embed__image-link">
                {content}
              </div>
            )
          }

          return (
            <a
              key={key}
              className="b-embed__image-link"
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              {...titleProps}
            >
              {content}
            </a>
          )
        })}
      </div>
    </figure>
  )
}

function ExternalCard({ embed, concealed }: { embed: ExternalEmbed; concealed: boolean }) {
  const href = safeExternalUrl(embed.uri)
  // crawler block pages arrive as ordinary titles, so show the address instead;
  // a legit title that merely mentions a captcha needs the description to agree
  const blocked =
    embed.title.length === 0 ||
    (looksLikeBlockPage(embed.title) && looksLikeBlockPage(embed.description))
  const title = blocked ? externalAddress(embed.uri, embed.domain) : embed.title
  const content = (
    <>
      {embed.thumb !== null && embed.thumb.length > 0 ? (
        <span className="b-embed__thumb" {...concealment(concealed)}>
          <DitherImage src={embed.thumb} alt={title} />
        </span>
      ) : null}
      <span className="b-embed__external-body">
        <span className="b-embed__external-title">{title}</span>
        <span className="b-embed__external-domain">
          {embed.domain.length > 0 ? embed.domain : 'external'}
        </span>
        {!blocked && embed.description.length > 0 ? (
          <span className="b-embed__external-description">{embed.description}</span>
        ) : null}
      </span>
    </>
  )

  if (href === null) {
    return <div className="b-embed b-embed--external">{content}</div>
  }

  return (
    <a className="b-embed b-embed--external" href={href} target="_blank" rel="noreferrer noopener">
      {content}
    </a>
  )
}

function QuoteCard({ post }: { post: QuotedPostModel }) {
  const [, navigate] = useLocation()
  const handle = post.author.handle.length > 0 ? post.author.handle : 'unknown'
  const name = post.author.displayName.length > 0 ? post.author.displayName : handle
  const href = `/thread?uri=${encodeURIComponent(post.uri)}`
  const profileHref = `/profile/${encodeURIComponent(handle)}`

  return (
    <article
      className="b-embed b-embed--quote"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the whole quote opens the quoted post
      tabIndex={0}
      onClick={(event) => {
        const target = event.target
        if (target instanceof HTMLElement && target.closest('a') !== null) return
        navigate(href)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        const target = event.target
        if (target instanceof HTMLElement && target.closest('a, button') !== null) return
        event.preventDefault()
        navigate(href)
      }}
    >
      <header className="b-embed__quote-head">
        <Link href={profileHref} className="b-embed__quote-author">
          <span>{name}</span>
        </Link>
        <span className="b-embed__quote-meta">@{handle}</span>
      </header>
      {post.text.length > 0 ? (
        <FacetText text={post.text} facets={post.facets} className="b-embed__quote-text" />
      ) : (
        <span className="b-embed__quote-empty">[no text]</span>
      )}
      <div className="b-embed__quote-actions">
        <Link href={href} className="b-embed__quote-open">
          open quoted post <Kbd>0</Kbd>
        </Link>
      </div>
    </article>
  )
}

function VideoCard({ embed, concealed }: { embed: VideoEmbed; concealed: boolean }) {
  return (
    <figure className="b-embed b-embed--video" {...concealment(concealed)}>
      <VideoPlayer video={embed} />
    </figure>
  )
}

function UnavailableCard({ embed }: { embed: UnavailableEmbed }) {
  const note =
    embed.reason === 'blocked'
      ? 'this quoted post is blocked'
      : embed.reason === 'detached'
        ? 'this quoted post was removed'
        : 'this quoted post was not found'

  return (
    <div className="b-embed b-embed--unavailable">
      <Tag tone="default">{embed.label}</Tag>
      <span className="b-embed__unavailable-note">{note}</span>
    </div>
  )
}

function UnknownCard({ embed }: { embed: UnknownEmbed }) {
  return (
    <div className="b-embed b-embed--unknown">
      <Tag tone="warn">unsupported embed</Tag>
      <span className="b-embed__unknown-type">
        {embed.typeName.length > 0 ? embed.typeName : 'unknown'}
      </span>
    </div>
  )
}

function Media({ embed, concealed }: { embed: MediaEmbed; concealed: boolean }) {
  switch (embed.type) {
    case 'images':
      return <ImageGrid images={embed.images} concealed={concealed} />
    case 'external':
      return <ExternalCard embed={embed} concealed={concealed} />
    case 'video':
      return <VideoCard embed={embed} concealed={concealed} />
    case 'unknown':
      return <UnknownCard embed={embed} />
  }
}

function RecordCard({ embed, concealed }: { embed: RecordWithMediaEmbed; concealed: boolean }) {
  return (
    <div className="b-embed b-embed--record">
      <QuoteCard post={embed.quote} />
      <Media embed={embed.media} concealed={concealed} />
    </div>
  )
}

export function Embeds({ embed, concealed = false }: EmbedsProps) {
  switch (embed.type) {
    case 'quote':
      return <QuoteCard post={embed.post} />
    case 'unavailable':
      return <UnavailableCard embed={embed} />
    case 'recordWithMedia':
      return <RecordCard embed={embed} concealed={concealed} />
    case 'images':
    case 'external':
    case 'video':
    case 'unknown':
      return <Media embed={embed} concealed={concealed} />
  }
}
