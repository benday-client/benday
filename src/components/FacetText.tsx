import { Link } from 'wouter'
import { facetHref, segmentText } from '../lib/facets'
import type { FacetSpan } from '../lib/types'

export interface FacetTextProps {
  text: string
  facets: readonly FacetSpan[]
  className?: string
}

export function FacetText({ text, facets, className }: FacetTextProps) {
  const segments = segmentText(text, facets)
  const classes = ['b-facet-text']
  if (className !== undefined) classes.push(className)

  let cursor = 0

  return (
    <span className={classes.join(' ')}>
      {segments.map((segment) => {
        const key = `${cursor}:${segment.feature?.kind ?? 'text'}`
        cursor += segment.text.length
        const feature = segment.feature
        if (feature === null) return <span key={key}>{segment.text}</span>

        if (feature.kind === 'bold') {
          return (
            <strong key={key} className="b-facet-text__bold">
              {segment.text}
            </strong>
          )
        }
        if (feature.kind === 'italic') {
          return (
            <em key={key} className="b-facet-text__italic">
              {segment.text}
            </em>
          )
        }
        if (feature.kind === 'strikethrough') {
          return (
            <s key={key} className="b-facet-text__strike">
              {segment.text}
            </s>
          )
        }
        if (feature.kind === 'code') {
          return (
            <code key={key} className="b-facet-text__code">
              {segment.text}
            </code>
          )
        }

        const link = facetHref(feature)
        if (link === null) return <span key={key}>{segment.text}</span>

        if (link.external) {
          return (
            <a
              key={key}
              className="b-facet-text__link"
              href={link.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {segment.text}
            </a>
          )
        }

        return (
          <Link key={key} href={link.href} className="b-facet-text__link">
            <span>{segment.text}</span>
          </Link>
        )
      })}
    </span>
  )
}
