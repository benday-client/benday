import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { type FacetLink, facetHref, segmentText } from '../lib/facets'
import type { FacetFeature, FacetSpan } from '../lib/types'

export interface FacetTextProps {
  text: string
  facets: readonly FacetSpan[]
  className?: string
}

/**
 * Marks nest before links so a bold link renders as `<a><strong>…</strong></a>`
 * regardless of the order features arrived in. Unknown features wrap in a plain
 * span, matching the old single-feature fallback.
 */
const FEATURE_RANK: Partial<Record<FacetFeature['kind'], number>> = {
  bold: 0,
  italic: 1,
  strikethrough: 2,
  code: 3,
}

function wrapFeature(
  feature: FacetFeature,
  children: ReactNode,
  key: string,
  link: FacetLink | null,
): ReactNode {
  if (feature.kind === 'bold') {
    return (
      <strong key={key} className="b-facet-text__bold">
        {children}
      </strong>
    )
  }
  if (feature.kind === 'italic') {
    return (
      <em key={key} className="b-facet-text__italic">
        {children}
      </em>
    )
  }
  if (feature.kind === 'strikethrough') {
    return (
      <s key={key} className="b-facet-text__strike">
        {children}
      </s>
    )
  }
  if (feature.kind === 'code') {
    return (
      <code key={key} className="b-facet-text__code">
        {children}
      </code>
    )
  }

  if (link === null) return <span key={key}>{children}</span>

  if (link.external) {
    return (
      <a
        key={key}
        className="b-facet-text__link"
        href={link.href}
        target="_blank"
        rel="noreferrer noopener"
      >
        {children}
        <span aria-hidden="true"> ↗</span>
      </a>
    )
  }

  return (
    <Link key={key} href={link.href} className="b-facet-text__link">
      <span>{children}</span>
    </Link>
  )
}

export function FacetText({ text, facets, className }: FacetTextProps) {
  const segments = segmentText(text, facets)
  const classes = ['b-facet-text']
  if (className !== undefined) classes.push(className)

  let cursor = 0

  return (
    <span className={classes.join(' ')} dir="auto">
      {segments.map((segment) => {
        const key = String(cursor)
        cursor += segment.text.length

        if (segment.features.length === 0) {
          return <span key={key}>{segment.text}</span>
        }

        const ordered = [...segment.features].sort(
          (left, right) => (FEATURE_RANK[left.kind] ?? 4) - (FEATURE_RANK[right.kind] ?? 4),
        )
        let node: ReactNode = segment.text
        let anchored = false
        for (const [index, feature] of ordered.entries()) {
          const link = facetHref(feature)
          // overlapping navigation never nests anchors; the first safe one wins
          if (link !== null && anchored) continue
          if (link !== null) anchored = true
          node = wrapFeature(feature, node, `${key}:${index}`, link)
        }
        return node
      })}
    </span>
  )
}
