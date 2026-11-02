import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModeCard } from './ModeCard'

function renderCard(active = false) {
  const onSelect = vi.fn()
  const result = render(
    <ModeCard
      label="mode"
      name="posts"
      description="every standalone post this account wrote"
      active={active}
      countLabel="12 posts"
      activeHint="← modes"
      onSelect={onSelect}
    />,
  )
  return { ...result, onSelect }
}

describe('ModeCard', () => {
  it('keeps a native button with phrasing-only descendants', () => {
    const { container } = renderCard()
    const button = screen.getByRole('button', { name: 'show posts' })
    expect(button.tagName).toBe('BUTTON')
    // a header, div or paragraph inside a button would be reparented by the
    // parser and split the accessible name and description
    expect(button.querySelector('header, div, p, section, article')).toBeNull()
    expect(button.textContent).toContain('posts')
    expect(container.querySelector('.b-mode-card')).toBe(button)
  })

  it('exposes one name, its description, count and pressed state', () => {
    const { container } = renderCard(true)
    const button = screen.getByRole('button', { name: 'show posts' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('data-active', 'true')

    const describedBy = button.getAttribute('aria-describedby') ?? ''
    expect(describedBy.length).toBeGreaterThan(0)
    const description = describedBy
      .split(' ')
      .map((id) => container.querySelector(`#${CSS.escape(id)}`)?.textContent ?? '')
      .join(' ')
    expect(description).toContain('every standalone post')
    expect(description).toContain('12 posts')
  })

  it('selects on a real pointer click', () => {
    const { onSelect } = renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'show posts' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
