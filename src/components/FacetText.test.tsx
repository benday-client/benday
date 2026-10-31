import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { FacetSpan } from '../lib/types'
import { FacetText } from './FacetText'

function renderText(text: string, facets: FacetSpan[]) {
  const location = memoryLocation({ path: '/' })
  return render(
    <Router hook={location.hook}>
      <FacetText text={text} facets={facets} />
    </Router>,
  )
}

describe('FacetText', () => {
  it('keeps one anchor for overlapping navigation and still formats the text', () => {
    const { container } = renderText('@ada.test', [
      { start: 0, end: 9, feature: { kind: 'mention', did: 'did:plc:ada', handle: 'ada.test' } },
      { start: 0, end: 9, feature: { kind: 'link', uri: 'https://example.com' } },
      { start: 0, end: 9, feature: { kind: 'bold' } },
    ])

    const anchors = container.querySelectorAll('a')
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toHaveAttribute('href', '/profile/ada.test')
    expect(container.querySelector('strong')?.textContent).toBe('@ada.test')
  })

  it('never nests anchors when bold splits a mention', () => {
    const { container } = renderText('@ada.test', [
      { start: 0, end: 9, feature: { kind: 'mention', did: 'did:plc:ada', handle: 'ada.test' } },
      { start: 0, end: 4, feature: { kind: 'bold' } },
    ])

    expect(container.querySelectorAll('a a')).toHaveLength(0)
    expect(container.textContent).toBe('@ada.test')
  })

  it('leaves an unsafe external link inert', () => {
    const { container } = renderText('click me', [
      { start: 0, end: 5, feature: { kind: 'link', uri: 'javascript:alert(1)' } },
    ])

    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('click me')
  })

  it('opens a safe external link in a new tab', () => {
    const { container } = renderText('site', [
      { start: 0, end: 4, feature: { kind: 'link', uri: 'https://example.com/x' } },
    ])

    const anchor = container.querySelector('a')
    expect(anchor).toHaveAttribute('href', 'https://example.com/x')
    expect(anchor).toHaveAttribute('rel', 'noreferrer noopener')
  })

  it('marks an external link with a decorative arrow outside its accessible name', () => {
    const { container } = renderText('visit site', [
      { start: 6, end: 10, feature: { kind: 'link', uri: 'https://example.com/x' } },
    ])

    expect(container.firstElementChild).toHaveAttribute('dir', 'auto')

    const anchor = screen.getByRole('link', { name: 'site' })
    expect(anchor).toHaveAttribute('href', 'https://example.com/x')
    expect(anchor).toHaveAttribute('target', '_blank')
    expect(anchor.textContent).toBe('site ↗')

    const arrow = anchor.lastElementChild
    expect(arrow).toHaveAttribute('aria-hidden', 'true')
    expect(arrow?.textContent).toBe(' ↗')
  })

  it('keeps internal mention and tag links free of the external arrow', () => {
    const mention = renderText('@ada.test', [
      { start: 0, end: 9, feature: { kind: 'mention', did: 'did:plc:ada', handle: 'ada.test' } },
    ])
    const mentionAnchor = mention.container.querySelector('a')
    expect(mentionAnchor).toHaveAttribute('href', '/profile/ada.test')
    expect(mentionAnchor?.textContent).toBe('@ada.test')
    expect(mentionAnchor).not.toHaveAttribute('target')
    expect(mentionAnchor).not.toHaveAttribute('rel')
    expect(mention.container.querySelector('[aria-hidden="true"]')).toBeNull()

    const tag = renderText('#design', [
      { start: 0, end: 7, feature: { kind: 'tag', tag: 'design' } },
    ])
    const tagAnchor = tag.container.querySelector('a')
    expect(tagAnchor).toHaveAttribute('href', '/search?q=%23design')
    expect(tagAnchor?.textContent).toBe('#design')
    expect(tag.container.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('wraps a tag as a search link', () => {
    const { container } = renderText('#design', [
      { start: 0, end: 7, feature: { kind: 'tag', tag: 'design' } },
    ])

    expect(container.querySelector('a')?.getAttribute('href')).toBe('/search?q=%23design')
  })
})
