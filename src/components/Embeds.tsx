import { Link } from 'wouter'
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

function ImageGrid({ images }: { images: readonly ImageModel[] }) {
  if (images.length === 0) return null
  const single = images.length === 1

  return (
    <figure className="b-embed b-embed--images">
      <div className="b-embed__grid" data-count={String(images.length)}>
        {images.map((image) => {
          const alt = image.alt.length > 0 ? image.alt : 'image'
          const href = safeExternalUrl(image.fullsize)
          const titleProps = image.alt.length > 0 ? { title: image.alt } : {}
          const content = (
            <>
              <span className="b-embed__image-frame">
                <DitherImage
                  src={image.fullsize.length > 0 ? image.fullsize : image.thumb || null}
                  alt={alt}
                  loading="lazy"
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

function ExternalCard({ embed }: { embed: ExternalEmbed }) {
  const href = safeExternalUrl(embed.uri)
  const title = embed.title.length > 0 ? embed.title : embed.uri
  const content = (
    <>
      {embed.thumb !== null && embed.thumb.length > 0 ? (
        <span className="b-embed__thumb">
          <DitherImage src={embed.thumb} alt={title} />
        </span>
      ) : null}
      <span className="b-embed__external-body">
        <span className="b-embed__external-title">{title}</span>
        <span className="b-embed__external-domain">
          {embed.domain.length > 0 ? embed.domain : 'external'}
        </span>
        {embed.description.length > 0 ? (
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
  const handle = post.author.handle.length > 0 ? post.author.handle : 'unknown'
  const name = post.author.displayName.length > 0 ? post.author.displayName : handle

  return (
    <article className="b-embed b-embed--quote">
      <header className="b-embed__quote-head">
        <Link
          href={`/thread?uri=${encodeURIComponent(post.uri)}`}
          className="b-embed__quote-author"
        >
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
        <Link href={`/thread?uri=${encodeURIComponent(post.uri)}`} className="b-embed__quote-open">
          open quoted post <Kbd>0</Kbd>
        </Link>
      </div>
    </article>
  )
}

function VideoCard({ embed }: { embed: VideoEmbed }) {
  return (
    <figure className="b-embed b-embed--video">
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

function Media({ embed }: { embed: MediaEmbed }) {
  switch (embed.type) {
    case 'images':
      return <ImageGrid images={embed.images} />
    case 'external':
      return <ExternalCard embed={embed} />
    case 'video':
      return <VideoCard embed={embed} />
    case 'unknown':
      return <UnknownCard embed={embed} />
  }
}

function RecordCard({ embed }: { embed: RecordWithMediaEmbed }) {
  return (
    <div className="b-embed b-embed--record">
      <QuoteCard post={embed.quote} />
      <Media embed={embed.media} />
    </div>
  )
}

export function Embeds({ embed }: EmbedsProps) {
  switch (embed.type) {
    case 'quote':
      return <QuoteCard post={embed.post} />
    case 'unavailable':
      return <UnavailableCard embed={embed} />
    case 'recordWithMedia':
      return <RecordCard embed={embed} />
    case 'images':
    case 'external':
    case 'video':
    case 'unknown':
      return <Media embed={embed} />
  }
}
