import { Link } from 'wouter'
import type {
  EmbedModel,
  ExternalEmbed,
  ImageModel,
  MediaEmbed,
  QuotedPostModel,
  RecordWithMediaEmbed,
  UnknownEmbed,
  VideoEmbed,
} from '../lib/types'
import { DitherImage } from './DitherImage'
import { FacetText } from './FacetText'
import { Tag } from './ui'

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

function embedTypeLabel(typeName: string): string {
  const marker = '.embed.'
  const markerIndex = typeName.indexOf(marker)
  if (markerIndex >= 0) {
    const rest = typeName.slice(markerIndex + marker.length)
    const hash = rest.indexOf('#')
    return hash >= 0 ? rest.slice(0, hash) : rest
  }
  const hash = typeName.lastIndexOf('#')
  const tail = hash >= 0 ? typeName.slice(hash + 1) : typeName
  const dot = tail.lastIndexOf('.')
  return dot >= 0 ? tail.slice(dot + 1) : tail
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
                  src={image.thumb.length > 0 ? image.thumb : null}
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
  const label = post.embedType === null ? '' : embedTypeLabel(post.embedType)

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
        {label.length > 0 ? <Tag tone="default">{label}</Tag> : null}
      </header>
      {post.text.length > 0 ? (
        <FacetText text={post.text} facets={post.facets} className="b-embed__quote-text" />
      ) : (
        <span className="b-embed__quote-empty">[no text]</span>
      )}
    </article>
  )
}

function VideoCard({ embed }: { embed: VideoEmbed }) {
  const alt = embed.alt.length > 0 ? embed.alt : 'video post'

  return (
    <figure className="b-embed b-embed--video">
      <span className="b-embed__video-frame">
        {embed.thumbnail !== null && embed.thumbnail.length > 0 ? (
          <DitherImage src={embed.thumbnail} alt={alt} />
        ) : null}
        <span className="b-embed__video-badge">
          <Tag tone="default">video</Tag>
        </span>
      </span>
      {embed.alt.length > 0 ? (
        <figcaption className="b-embed__video-alt">{embed.alt}</figcaption>
      ) : null}
    </figure>
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
    case 'recordWithMedia':
      return <RecordCard embed={embed} />
    case 'images':
    case 'external':
    case 'video':
    case 'unknown':
      return <Media embed={embed} />
  }
}
