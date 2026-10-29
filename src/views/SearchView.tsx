import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'wouter'
import { Deck } from '../components/Deck'
import { PostCard } from '../components/PostCard'
import { Button, EmptyState, ErrorNotice, Frame, TextInput } from '../components/ui'
import { suggestionAt, useActorSuggestions } from '../hooks/useActorSuggestions'
import { usePostFeed } from '../hooks/useBskyQueries'
import { useTagSuggestions } from '../hooks/useTagSuggestions'
import { useViewerSync } from '../hooks/useViewerSync'
import { capabilitiesFor } from '../lib/appviews'
import { errorInfo } from '../lib/errors'
import { useSettings } from '../lib/store'
import { useUiStore } from '../lib/ui'

export default function SearchView() {
  const [, navigate] = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const openPost = useUiStore((state) => state.openPost)
  const query = (searchParams.get('q') ?? '').trim()
  const [draft, setDraft] = useState(query)
  const [cursor, setCursor] = useState(0)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  useEffect(() => {
    setDraft(query)
  }, [query])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const appView = useSettings((state) => state.appView)
  const supported = capabilitiesFor(appView).search
  const token = suggestOpen ? suggestionAt(draft, cursor) : null
  const actorSuggestions = useActorSuggestions(
    token?.kind === 'mention' ? token.query : '',
    token?.kind === 'mention',
  )
  const tagSuggestions = useTagSuggestions(
    token?.kind === 'tag' ? token.query : '',
    token?.kind === 'tag',
  )

  const suggestions =
    token?.kind === 'tag'
      ? (tagSuggestions.tags.length > 0
          ? tagSuggestions.tags
          : token.query.length > 0
            ? [token.query]
            : []
        ).map((tag) => ({
          key: `tag:${tag}`,
          value: tag,
          label: `#${tag}`,
          detail: 'tag',
        }))
      : token?.kind === 'mention' && token.query.length > 0
        ? actorSuggestions.suggestions.length > 0
          ? actorSuggestions.suggestions.map((actor) => ({
              key: actor.did,
              value: actor.handle,
              label: `@${actor.handle}`,
              detail: actor.displayName,
            }))
          : [
              {
                key: 'literal-handle',
                value: token.query,
                label: `@${token.query}`,
                detail: 'handle',
              },
            ]
        : []

  const suggestionsPending =
    token?.kind === 'tag' ? tagSuggestions.isPending : actorSuggestions.isPending
  const showSuggestions = token !== null && (suggestionsPending || suggestions.length > 0)
  const activeSuggestion =
    suggestions.length > 0 ? Math.min(selectedSuggestion, suggestions.length - 1) : 0

  const feed = usePostFeed({ kind: 'search', query: supported ? query : '' })
  const posts = feed.data ?? []
  useViewerSync(posts)
  const info = feed.error !== null ? errorInfo(feed.error) : null

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSuggestOpen(false)
    setSelectedSuggestion(0)
    const next = draft.trim()
    if (next.length > 0) {
      setSearchParams({ q: next }, { replace: true })
    } else {
      setSearchParams({}, { replace: true })
    }
  }

  const applySuggestion = (value: string) => {
    const active = suggestionAt(draft, cursor)
    if (active === null) return

    const inserted = `${active.kind === 'tag' ? '#' : '@'}${value} `
    const next = `${draft.slice(0, active.start)}${inserted}${draft.slice(active.end)}`
    const position = active.start + inserted.length
    setDraft(next)
    setCursor(position)
    setSuggestOpen(false)
    setSelectedSuggestion(0)
    setSearchParams({ q: next.trim() }, { replace: true })

    window.requestAnimationFrame(() => {
      const input = searchRef.current
      if (input === null) return
      input.focus()
      input.setSelectionRange(position, position)
    })
  }

  return (
    <section className="b-view">
      <h1 className="visually-hidden">search</h1>
      <div className="b-view__tools">
        <form className="b-view__form" onSubmit={handleSubmit}>
          <TextInput
            label="query"
            placeholder="words, #tag, @handle"
            inputRef={searchRef}
            role="combobox"
            aria-expanded={showSuggestions}
            aria-controls={showSuggestions ? listboxId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              showSuggestions && suggestions.length > 0
                ? `${listboxId}-option-${activeSuggestion}`
                : undefined
            }
            value={draft}
            onChange={(event) => {
              const next = event.target.value
              const position = event.target.selectionStart ?? next.length
              setDraft(next)
              setCursor(position)
              setSuggestOpen(suggestionAt(next, position) !== null)
              setSelectedSuggestion(0)
            }}
            onSelect={(event) => {
              const position = event.currentTarget.selectionStart ?? 0
              setCursor(position)
              setSuggestOpen(suggestionAt(draft, position) !== null)
            }}
            onBlur={() => {
              setSuggestOpen(false)
            }}
            onKeyDown={(event) => {
              if (!showSuggestions) return

              const count = suggestions.length
              if (event.key === 'ArrowDown' && count > 0) {
                event.preventDefault()
                setSelectedSuggestion((index) => (index + 1) % count)
                return
              }
              if (event.key === 'ArrowUp' && count > 0) {
                event.preventDefault()
                setSelectedSuggestion((index) => (index - 1 + count) % count)
                return
              }
              if ((event.key === 'Enter' || event.key === 'Tab') && count > 0) {
                event.preventDefault()
                const selected = suggestions[activeSuggestion]
                if (selected !== undefined) applySuggestion(selected.value)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setSuggestOpen(false)
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="solid">
            scan
          </Button>
        </form>

        {token !== null && showSuggestions ? (
          <div
            className="b-compose__suggestions"
            role="listbox"
            id={listboxId}
            aria-label="suggestions"
          >
            {suggestionsPending && suggestions.length === 0 ? (
              <p className="b-compose__suggestion-note">searching</p>
            ) : (
              suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.key}
                  type="button"
                  role="option"
                  id={`${listboxId}-option-${index}`}
                  aria-selected={index === activeSuggestion}
                  className="b-compose__suggestion"
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    applySuggestion(suggestion.value)
                  }}
                >
                  <span>{suggestion.label}</span>
                  {suggestion.detail.length > 0 ? <span>{suggestion.detail}</span> : null}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
      <div className="b-view__body">
        {!supported ? (
          <Frame label="search unavailable" tone="accent" className="b-view__warning">
            <p>this appview does not expose search. switch appviews in the top bar.</p>
          </Frame>
        ) : query.length === 0 ? (
          <EmptyState title="quiet band" hint="type a query to scan the network" />
        ) : info !== null && posts.length === 0 ? (
          <ErrorNotice title={info.title} message={info.detail} onRetry={feed.retry} />
        ) : (
          <Deck
            items={posts}
            getKey={(post) => post.uri}
            renderItem={(post, index, focused) => (
              <PostCard post={post} index={index} focused={focused} />
            )}
            onActivate={(post) => {
              openPost(post)
              navigate(`/thread?uri=${encodeURIComponent(post.uri)}`)
            }}
            pending={feed.isPending}
            hasMore={feed.hasMore}
            loadingMore={feed.isLoadingMore}
            onLoadMore={feed.loadMore}
            loadMoreError={feed.loadMoreError}
            onRetryLoadMore={feed.retryLoadMore}
            label="search results"
            stateKey={`search:${query}`}
            empty={
              <EmptyState title="no matches" hint="the search returned nothing for this query" />
            }
          />
        )}
      </div>
    </section>
  )
}
