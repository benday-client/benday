import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '../lib/auth'
import { profileFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { Avatar } from './Avatar'
import { ProfileCard } from './ProfileCard'

const FAMILY = '👩‍👩‍👧‍👦'

function fallback(container: HTMLElement): Element | null {
  return container.querySelector('.dither-image--fallback')
}

describe('Avatar', () => {
  it('shows one whole grapheme instead of a surrogate half', () => {
    const rocket = render(<Avatar src={null} alt="" name="🚀 rocket" />)
    expect(fallback(rocket.container)?.textContent).toBe('🚀')

    const family = render(<Avatar src={null} alt="" name={`${FAMILY} family`} />)
    expect(fallback(family.container)?.textContent).toBe(FAMILY)

    const combining = render(<Avatar src={null} alt="" name={'e\u0301clair'} />)
    expect(fallback(combining.container)?.textContent).toBe('E\u0301')
  })

  it('uppercases a display-name initial and preserves a handle on request', () => {
    const displayName = render(<Avatar src={null} alt="" name="ada" />)
    expect(fallback(displayName.container)?.textContent).toBe('A')

    const handle = render(<Avatar src={null} alt="" name="ada.test" preserveCase />)
    expect(fallback(handle.container)?.textContent).toBe('a')
  })

  it('uses the empty glyph only for an empty name', () => {
    const unknown = render(<Avatar src={null} alt="" name="" />)
    expect(fallback(unknown.container)?.textContent).toBe('?')

    const dot = render(<Avatar src={null} alt="" name="" emptyGlyph="·" />)
    expect(fallback(dot.container)?.textContent).toBe('·')
  })

  it('keeps the accessible name on the fallback and hides a decorative one', () => {
    const named = render(<Avatar src={null} alt="avatar of @ada" name="ada" />)
    expect(named.getByRole('img', { name: 'avatar of @ada' })).toHaveTextContent('A')

    const decorative = render(<Avatar src={null} alt="" name="ada" />)
    expect(fallback(decorative.container)).toHaveAttribute('aria-hidden', 'true')
  })

  it('falls back to the initial when the image fails to load', () => {
    const { container } = render(
      <Avatar src="data:image/gif;base64,R0lGOD" alt="avatar of @ada" name="ada" />,
    )
    const image = screen.getByRole('img', { name: 'avatar of @ada' })
    expect(image.tagName).toBe('IMG')

    fireEvent.error(image)

    expect(fallback(container)).toHaveTextContent('A')
    expect(screen.getByRole('img', { name: 'avatar of @ada' })).toBe(fallback(container))
  })

  it('ignores leading whitespace and treats a whitespace-only name as empty', () => {
    const leading = render(<Avatar src={null} alt="" name=" ada" />)
    expect(fallback(leading.container)?.textContent).toBe('A')

    const trailing = render(<Avatar src={null} alt="" name="ada   " />)
    expect(fallback(trailing.container)?.textContent).toBe('A')

    const blank = render(<Avatar src={null} alt="" name="   " />)
    expect(fallback(blank.container)?.textContent).toBe('?')

    const blankCustom = render(<Avatar src={null} alt="" name="   " emptyGlyph="·" />)
    expect(fallback(blankCustom.container)?.textContent).toBe('·')
  })

  it('keeps a lowercase handle intact when preserveCase is set', () => {
    const handle = render(<Avatar src={null} alt="" name="ada.test" preserveCase />)
    expect(fallback(handle.container)?.textContent).toBe('a')

    const sharpS = render(<Avatar src={null} alt="" name="ßeta" preserveCase />)
    expect(fallback(sharpS.container)?.textContent).toBe('ß')
  })

  it('keeps an expanding uppercase initial to a single glyph', () => {
    // ß uppercases to SS and ﬁ to FI; neither may overflow a one-glyph square
    const sharpS = render(<Avatar src={null} alt="" name="straße" />)
    expect(fallback(sharpS.container)?.textContent).toBe('S')

    const ligature = render(<Avatar src={null} alt="" name="ﬁona" />)
    expect(fallback(ligature.container)?.textContent).toBe('F')

    const longLigature = render(<Avatar src={null} alt="" name="ﬃona" />)
    expect(fallback(longLigature.container)?.textContent).toBe('F')
  })

  it('leaves emoji and combining clusters unchanged', () => {
    const emoji = render(<Avatar src={null} alt="" name="🚀 rocket" />)
    expect(fallback(emoji.container)?.textContent).toBe('🚀')

    const family = render(<Avatar src={null} alt="" name={`${FAMILY} family`} preserveCase />)
    expect(fallback(family.container)?.textContent).toBe(FAMILY)

    const combining = render(<Avatar src={null} alt="" name={'e\u0301clair'} preserveCase />)
    expect(fallback(combining.container)?.textContent).toBe('e\u0301')
  })

  it('uses the empty glyph for empty names only', () => {
    const custom = render(<Avatar src={null} alt="" name="" emptyGlyph="🙂" />)
    expect(fallback(custom.container)?.textContent).toBe('🙂')

    const named = render(<Avatar src={null} alt="" name="ada" emptyGlyph="🙂" />)
    expect(fallback(named.container)?.textContent).toBe('A')
  })
})

describe('ProfileCard avatar', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
  })

  function renderProfile(displayName: string, handle = 'test.bsky.social') {
    return render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ProfileCard profile={profileFixture({ displayName, handle })} />
      </QueryClientProvider>,
    )
  }

  it('shows a whole emoji from the display name', () => {
    const { container } = renderProfile(`${FAMILY} family`)

    expect(container.querySelector('.b-profile__avatar .dither-image--fallback')?.textContent).toBe(
      FAMILY,
    )
  })

  it('falls back to the handle initial when the display name is empty', () => {
    const { container } = renderProfile('', 'ada.test')

    expect(container.querySelector('.b-profile__avatar .dither-image--fallback')?.textContent).toBe(
      'A',
    )
  })
})
