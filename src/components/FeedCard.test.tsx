import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FeedCardBackProps, FeedChoice } from './FeedCard'
import { FeedCard, FeedCardBack } from './FeedCard'

function feedChoice(): FeedChoice {
  return {
    kind: 'feed',
    key: 'whats-hot',
    uri: 'at://did:plc:test/app.bsky.feed.generator/whats-hot',
    name: '🚀 rocket feed',
    description: '',
    avatar: null,
    source: { kind: 'feed', uri: 'at://did:plc:test/app.bsky.feed.generator/whats-hot' },
  }
}

describe('FeedCard avatar', () => {
  it('shows one whole emoji from the feed name', () => {
    const { container } = render(
      <FeedCard choice={feedChoice()} active={false} focused={false} onSelect={() => {}} />,
    )
    expect(
      container.querySelector('.b-feed-card__avatar .dither-image--fallback')?.textContent,
    ).toBe('🚀')
  })

  it('opens the feed from a click', () => {
    const onSelect = vi.fn()
    render(<FeedCard choice={feedChoice()} active={false} focused={false} onSelect={onSelect} />)
    fireEvent.click(screen.getByLabelText('open 🚀 rocket feed'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})

describe('FeedCardBack', () => {
  const backProps = (overrides: Partial<FeedCardBackProps> = {}): FeedCardBackProps => ({
    feedName: 'posts',
    postIndex: 2,
    postDate: '2026-10-29T12:00:00.000Z',
    appview: 'bluesky',
    ...overrides,
  })

  it('keeps the date, appview and a working refresh inside its article', () => {
    const onRefresh = vi.fn()
    const { container } = render(<FeedCardBack {...backProps({ onRefresh })} />)

    const article = container.querySelector('article.b-card-back')
    if (article === null) throw new Error('card back missing')

    expect(article.getAttribute('aria-hidden')).toBeNull()
    expect(article.querySelector('.b-card-back__index')?.textContent).toBe('[02]')
    expect(article.querySelector('.b-card-back__feed')?.textContent).toBe('posts')
    expect(article.querySelector('.b-card-back__date')?.textContent).not.toBe('')
    expect(article.querySelector('.b-card-back__appview')?.textContent).toBe('bluesky')
    expect(article.querySelector('.b-card-back__hint')?.textContent).toBe('← feeds')
    // the footer is still the article's own, never a button inside a button
    expect(article.querySelector('footer')).not.toBeNull()
    expect(article.querySelector('button button')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('is decorative when it cannot refresh', () => {
    const { container } = render(<FeedCardBack {...backProps({ postDate: '' })} />)

    expect(container.querySelector('article')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.b-card-back__date')?.textContent).toBe('—')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('labels the pending refresh state', () => {
    render(<FeedCardBack {...backProps({ onRefresh: () => {}, refreshing: true })} />)
    expect(screen.getByRole('button')).toHaveTextContent('refreshing')
  })
})
