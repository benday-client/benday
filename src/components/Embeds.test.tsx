import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  ExternalEmbed,
  ImageEmbed,
  ImageModel,
  QuotedPostModel,
  RecordWithMediaEmbed,
  VideoEmbed,
} from '../lib/types'
import { Embeds } from './Embeds'

const BROKEN = 'data:image/png;base64,AAAA'

function external(overrides: Partial<Omit<ExternalEmbed, 'type'>>): ExternalEmbed {
  return {
    type: 'external',
    uri: overrides.uri ?? 'https://example.com/',
    title: overrides.title ?? 'a blog post',
    description: overrides.description ?? 'a description',
    thumb: overrides.thumb ?? null,
    domain: overrides.domain ?? 'example.com',
  }
}

function image(alt: string): ImageModel {
  return { thumb: BROKEN, fullsize: 'https://cdn.test/full.jpg', alt, width: 4, height: 3 }
}

function imageEmbed(...alts: string[]): ImageEmbed {
  return { type: 'images', images: alts.map(image) }
}

function quoted(text: string): QuotedPostModel {
  return {
    uri: 'at://did:plc:quoted/app.bsky.feed.post/1',
    cid: 'quoted-cid',
    author: {
      did: 'did:plc:quoted',
      handle: 'quoted.test',
      displayName: 'quoted',
      avatar: null,
      muted: false,
      blocked: false,
    },
    text,
    facets: [],
    indexedAt: '2026-10-29T12:00:00.000Z',
    embedType: 'app.bsky.embed.record#view',
  }
}

const video: VideoEmbed = {
  type: 'video',
  thumbnail: BROKEN,
  alt: 'a clip',
  playlist: 'https://example.test/clip.m3u8',
}

describe('external card', () => {
  it('shows the address instead of a crawler block page', () => {
    render(
      <Embeds
        embed={external({
          uri: 'https://utcc.utoronto.ca/~cks/space/blog/linux/TooGenericUserAgent',
          title: "You're using a tool with a too-generic User-Agent",
          description: 'Please send a genuine User-Agent header.',
          domain: 'utcc.utoronto.ca',
        })}
      />,
    )

    expect(
      screen.getByText('utcc.utoronto.ca/~cks/space/blog/linux/TooGenericUserAgent'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/too-generic/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/genuine user-agent/i)).not.toBeInTheDocument()
    expect(screen.getByText('utcc.utoronto.ca')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://utcc.utoronto.ca/~cks/space/blog/linux/TooGenericUserAgent',
    )
  })

  it('keeps the title, domain and description of a normal preview', () => {
    render(
      <Embeds
        embed={external({
          uri: 'https://example.com/notes/one',
          title: 'a blog post',
          domain: 'example.com',
        })}
      />,
    )

    expect(screen.getByText('a blog post')).toBeInTheDocument()
    expect(screen.getByText('example.com')).toBeInTheDocument()
    expect(screen.getByText('a description')).toBeInTheDocument()
    expect(screen.queryByText('example.com/notes/one')).not.toBeInTheDocument()
  })

  it('keeps a legitimate title that mentions a block-page word', () => {
    render(
      <Embeds
        embed={external({
          title: 'forbidden fruit',
          description: 'an essay about the fruit itself',
        })}
      />,
    )

    expect(screen.getByText('forbidden fruit')).toBeInTheDocument()
    expect(screen.getByText('an essay about the fruit itself')).toBeInTheDocument()
  })

  it('keeps a legitimate title whose description is empty', () => {
    const { container } = render(
      <Embeds
        embed={external({
          uri: 'https://example.com/captcha-guide',
          title: 'captcha',
          description: '',
        })}
      />,
    )

    expect(container.querySelector('.b-embed__external-title')?.textContent).toBe('captcha')
    expect(screen.queryByText('example.com/captcha-guide')).not.toBeInTheDocument()
  })

  it('falls back to the domain when the uri does not parse', () => {
    const { container } = render(
      <Embeds
        embed={external({
          uri: 'not a url',
          title: '',
          description: '',
          domain: 'example.com',
        })}
      />,
    )

    expect(container.querySelector('.b-embed__external-title')?.textContent).toBe('example.com')
    expect(container.querySelector('.b-embed__external-domain')?.textContent).toBe('example.com')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('concealed media', () => {
  it('gates a concealed image grid and clears the gate once it is revealed', () => {
    const embed = imageEmbed('a caption', 'another caption')
    const { container, rerender } = render(<Embeds embed={embed} concealed />)

    const figure = container.querySelector('figure.b-embed--images')
    expect(figure?.hasAttribute('inert')).toBe(true)
    expect(figure?.getAttribute('aria-hidden')).toBe('true')

    rerender(<Embeds embed={embed} concealed={false} />)

    expect(figure?.hasAttribute('inert')).toBe(false)
    expect(figure?.getAttribute('aria-hidden')).toBeNull()
  })

  it('gates a concealed video figure', () => {
    const { container } = render(<Embeds embed={video} concealed />)

    const figure = container.querySelector('figure.b-embed--video')
    expect(figure?.hasAttribute('inert')).toBe(true)
    expect(figure?.getAttribute('aria-hidden')).toBe('true')
  })

  it('gates only the external thumbnail and keeps its text and link live', () => {
    const { container } = render(
      <Embeds embed={external({ thumb: 'https://cdn.test/thumb.jpg' })} concealed />,
    )

    const thumb = container.querySelector('.b-embed__thumb')
    expect(thumb?.hasAttribute('inert')).toBe(true)
    expect(thumb?.getAttribute('aria-hidden')).toBe('true')

    const card = screen.getByRole('link')
    expect(card.hasAttribute('inert')).toBe(false)
    expect(card.getAttribute('aria-hidden')).toBeNull()
    expect(screen.getByText('a blog post')).toBeInTheDocument()
    expect(screen.getByText('a description')).toBeInTheDocument()
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })

  it('leaves a thumbless external card untouched by concealment', () => {
    const { container } = render(<Embeds embed={external({ thumb: null })} concealed />)

    expect(container.querySelector('.b-embed__thumb')).toBeNull()
    const card = screen.getByRole('link')
    expect(card.hasAttribute('inert')).toBe(false)
    expect(card.getAttribute('aria-hidden')).toBeNull()
    expect(screen.getByText('a blog post')).toBeInTheDocument()
  })

  it('gates the media of a quote-with-media while the quoted text stays live', () => {
    const embed: RecordWithMediaEmbed = {
      type: 'recordWithMedia',
      quote: quoted('quoted words'),
      media: imageEmbed('media caption'),
    }
    const { container } = render(<Embeds embed={embed} concealed />)

    const figure = container.querySelector('figure.b-embed--images')
    expect(figure?.hasAttribute('inert')).toBe(true)
    expect(figure?.getAttribute('aria-hidden')).toBe('true')

    const quote = container.querySelector('.b-embed--quote')
    expect(quote?.hasAttribute('inert')).toBe(false)
    expect(quote?.getAttribute('aria-hidden')).toBeNull()
    expect(quote?.textContent).toContain('quoted words')
    expect(screen.getByRole('link', { name: /open quoted post/i })).toBeInTheDocument()
  })

  it('leaves a quote embed without media reachable while concealed', () => {
    const { container } = render(
      <Embeds embed={{ type: 'quote', post: quoted('only words') }} concealed />,
    )

    expect(container.querySelector('[inert]')).toBeNull()
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(screen.getByText('only words')).toBeInTheDocument()
  })

  it('never gates an embed that is not concealed', () => {
    const { container } = render(
      <>
        <Embeds embed={imageEmbed('bare caption')} />
        <Embeds embed={video} />
        <Embeds embed={external({ thumb: 'https://cdn.test/thumb.jpg' })} />
      </>,
    )

    expect(container.querySelector('[inert]')).toBeNull()
    expect(container.querySelector('.b-embed--images[aria-hidden]')).toBeNull()
    expect(container.querySelector('.b-embed--video[aria-hidden]')).toBeNull()
    expect(container.querySelector('.b-embed__thumb[aria-hidden]')).toBeNull()
  })
})
