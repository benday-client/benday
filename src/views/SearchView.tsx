import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'wouter'
import { Avatar } from '../components/Avatar'
import { Deck } from '../components/Deck'
import { PostCard } from '../components/PostCard'
import {
  Button,
  CardBackButton,
  cardBackIndex,
  EmptyState,
  ErrorNotice,
  ModeCard,
  TextInput,
} from '../components/ui'
import {
  buildSuggestions,
  insertSuggestion,
  suggestionAt,
  useActorSuggestions,
} from '../hooks/useActorSuggestions'
import { useActorSearch, usePostFeed } from '../hooks/useBskyQueries'
import { useDealFlash } from '../hooks/useDealFlash'
import { useDismissEscape } from '../hooks/useDismissEscape'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useRetainedError } from '../hooks/useRetainedError'
import { useViewerSync } from '../hooks/useViewerSync'
import { useAuthStore } from '../lib/auth'
import { focusDeckAfterSwap } from '../lib/deckFocus'
import { errorInfo } from '../lib/errors'
import { resultCountLabel, SEARCH_MODES, type SearchMode, searchModeName } from '../lib/searchModes'
import type { PostModel, SearchActorModel } from '../lib/types'
import { useUiStore } from '../lib/ui'

function actorHref(handle: string): string {
  return `/profile/${encodeURIComponent(handle)}`
}

function ActorCard({ actor }: { actor: SearchActorModel }) {
  const displayName = actor.displayName.length > 0 ? actor.displayName : actor.handle

  return (
    <article className="b-frame b-search-card">
      <header className="b-frame__head">
        <span className="b-frame__label mono-label">user</span>
      </header>
      <div className="b-frame__body b-search-card__body">
        <div className="b-search-card__identity">
          <span className="b-search-card__avatar">
            <Avatar src={actor.avatar} alt={`avatar of @${actor.handle}`} name={displayName} />
          </span>
          <span className="b-search-card__names">
            <Link href={actorHref(actor.handle)} className="b-search-card__name">
              {displayName}
            </Link>
            <span className="b-search-card__handle">@{actor.handle}</span>
          </span>
        </div>
        {actor.description.length > 0 ? (
          <p className="b-search-card__description">{actor.description}</p>
        ) : null}
      </div>
    </article>
  )
}

export default function SearchView() {
  const [, navigate] = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const openPost = useUiStore((state) => state.openPost)
  const query = (searchParams.get('q') ?? '').trim()
  const [mode, setMode] = useState<SearchMode>('posts')
  const [modeDeck, setModeDeck] = useState(false)
  const [dealMode, playDeal] = useDealFlash<'modes' | 'results'>()
  const wide = useMediaQuery('(min-width: 900px)')
  const [draft, setDraft] = useState(query)
  const [cursor, setCursor] = useState(0)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const viewRef = useRef<HTMLElement>(null)
  const listboxId = useId()
  // an accepted suggestion keeps its untrimmed draft while the URL carries the
  // trimmed query; only a query we did not write replaces the draft
  const expectedQueryRef = useRef<string | null>(null)
  const focusDisposerRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (expectedQueryRef.current === query) {
      expectedQueryRef.current = null
      return
    }
    expectedQueryRef.current = null
    setDraft(query)
  }, [query])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const viewerDid = useAuthStore((state) => state.account?.did ?? null)
  const token = suggestOpen ? suggestionAt(draft, cursor) : null
  const actorSuggestions = useActorSuggestions(token?.query ?? '', token !== null)
  const suggestions = buildSuggestions(token, actorSuggestions.suggestions)
  const suggestionsPending = actorSuggestions.isPending
  const showSuggestions = token !== null && (suggestionsPending || suggestions.length > 0)
  const activeSuggestion =
    suggestions.length > 0 ? Math.min(selectedSuggestion, suggestions.length - 1) : 0

  // only the active mode fetches; the others keep whatever they already cached
  const feed = usePostFeed({ kind: 'search', query }, mode === 'posts')
  const users = useActorSearch(query, mode === 'users')
  const posts = feed.data ?? []
  const userResults = users.data ?? []
  useViewerSync(posts)

  const deckStateKey = JSON.stringify(['search-results', mode, query])
  // posts carry viewer-filtered interaction state; users do not
  const postsStateKey = JSON.stringify(['search-posts', query, viewerDid ?? 'anonymous'])
  const emptyQuery = query.length === 0
  // a mode that never fetched has no result count yet
  const modeCounts: Record<SearchMode, number | null> = {
    posts: feed.data === null ? null : posts.length,
    users: users.data === null ? null : userResults.length,
  }
  const modeIndex = Math.max(
    0,
    SEARCH_MODES.findIndex((option) => option.mode === mode),
  )

  const activeData: readonly unknown[] | null = mode === 'posts' ? feed.data : users.data
  const activeError = mode === 'posts' ? feed.error : users.error
  const activeFetching = mode === 'posts' ? feed.isFetching : users.isFetching
  const activeRetry = mode === 'posts' ? feed.retry : users.retry
  const failure = useRetainedError(
    // the viewer belongs to the identity only for posts, whose rows carry
    // viewer-filtered state; users resolve independently
    JSON.stringify(['search-failure', mode, query, viewerDid ?? 'anonymous']),
    activeData !== null,
    activeError,
    activeFetching,
  )
  const activeInfo = failure.error !== null ? errorInfo(failure.error) : null
  // cached rows stay on screen, so the failure sits beside them rather than
  // replacing the deck; a retry keeps its own announcement and focus
  const inlineWarningInfo =
    activeInfo !== null && activeData !== null && activeData.length > 0 && !(wide && modeDeck)
      ? activeInfo
      : null
  const inlineWarning =
    inlineWarningInfo !== null ? (
      <ErrorNotice
        title={inlineWarningInfo.title}
        message={inlineWarningInfo.detail}
        retrying={failure.retrying}
        onRetry={() => {
          failure.retry(activeRetry)
        }}
      />
    ) : null
  const statusText =
    !emptyQuery && activeInfo === null
      ? activeData === null
        ? activeFetching
          ? `searching ${searchModeName(mode)}`
          : ''
        : `${resultCountLabel(modeCounts[mode])} in ${searchModeName(mode)}`
      : ''

  const requestDeckFocus = useCallback(() => {
    focusDisposerRef.current?.()
    focusDisposerRef.current = focusDeckAfterSwap(viewRef.current)
  }, [])

  // a recovery control disappears with the failure it was reporting, so a
  // reader who was on it lands on the deck it guarded instead of on the body
  const showingFailure = activeInfo !== null
  const failureShownRef = useRef(showingFailure)
  useEffect(() => {
    const wasShowing = failureShownRef.current
    failureShownRef.current = showingFailure
    if (!wasShowing || showingFailure) return
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    requestDeckFocus()
  }, [showingFailure, requestDeckFocus])

  const switchModeDeck = useCallback(
    (next: boolean) => {
      setModeDeck(next)
      playDeal(next ? 'modes' : 'results')
    },
    [playDeal],
  )

  const chooseMode = (next: SearchMode) => {
    setMode(next)
    setModeDeck(false)
    playDeal('results')
    // the modes deck unmounts with the choice, so the results deck takes over
    requestDeckFocus()
  }

  // a clicked card and a deck activation open the same thread; the post is
  // handed to the route so it can render before the thread request settles
  const openThread = useCallback(
    (post: PostModel) => {
      openPost(post)
      navigate(`/thread?uri=${encodeURIComponent(post.uri)}`)
    },
    [navigate, openPost],
  )

  useEffect(() => {
    return () => {
      focusDisposerRef.current?.()
      focusDisposerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!wide) setModeDeck(false)
  }, [wide])

  // the mode deck closes before the app's back layer can leave search; a
  // keyboard exit from the mode cards lands on the results deck
  useDismissEscape(modeDeck, () => {
    switchModeDeck(false)
    requestDeckFocus()
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSuggestOpen(false)
    setSelectedSuggestion(0)
    const next = draft.trim()
    if (next.length > 0 && next === query) {
      if (mode === 'posts') {
        feed.retry()
      } else {
        users.retry()
      }
    } else if (next.length > 0) {
      setSearchParams({ q: next }, { replace: true })
    } else {
      setSearchParams({}, { replace: true })
    }
    // a scan always lands on results, never on the mode cards; submitting is a
    // query edit, so any pending swap focus is cancelled instead of taken
    if (modeDeck) {
      focusDisposerRef.current?.()
      focusDisposerRef.current = null
      switchModeDeck(false)
    }
  }

  const applySuggestion = (value: string) => {
    const active = suggestionAt(draft, cursor)
    if (active === null) return

    const next = insertSuggestion(draft, active, value)
    setDraft(next.text)
    setCursor(next.cursor)
    setSuggestOpen(false)
    setSelectedSuggestion(0)
    expectedQueryRef.current = next.text.trim()
    setSearchParams({ q: next.text.trim() }, { replace: true })

    window.requestAnimationFrame(() => {
      const input = searchRef.current
      if (input === null) return
      input.focus()
      input.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const quietBand = <EmptyState title="quiet band" hint="type a query to scan the network" />

  // one peek serves all three result branches
  const modePeek = (
    <CardBackButton
      label="search"
      meta={searchModeName(mode)}
      index={modeCounts[mode] === null ? '[--]' : cardBackIndex(modeCounts[mode])}
      title={searchModeName(mode)}
      detail={resultCountLabel(modeCounts[mode])}
      hint="← modes"
      ariaLabel={`change search mode, ${searchModeName(mode)}`}
      onClick={() => {
        switchModeDeck(true)
        requestDeckFocus()
      }}
    />
  )
  const modeBack = (
    <CardBackButton
      label="modes"
      index="↩"
      title={`back to ${query.length > 0 ? query : 'empty query'}`}
      detail="results"
      hint="← results"
      ariaLabel="back to results"
      onClick={() => {
        switchModeDeck(false)
        requestDeckFocus()
      }}
    />
  )

  return (
    <section className="b-view" ref={viewRef}>
      <h1 className="visually-hidden">search</h1>
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {statusText}
      </p>
      <search className="b-view__tools" aria-label="search">
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
              // a switcher or another layer already claimed this key
              if (event.defaultPrevented) return
              // an IME owns the key that commits its composition
              if (event.nativeEvent.isComposing || event.keyCode === 229) return

              if (event.key === 'Escape' && !event.shiftKey && !event.altKey) {
                if (event.ctrlKey || event.metaKey) return
                // the field owns Escape while it holds focus: suggestions
                // first, then the query, then the results deck behind it
                event.preventDefault()
                if (showSuggestions) {
                  setSuggestOpen(false)
                  return
                }
                if (draft.length > 0 || query.length > 0) {
                  setDraft('')
                  setCursor(0)
                  setSelectedSuggestion(0)
                  if (query.length > 0) setSearchParams({}, { replace: true })
                  return
                }
                event.currentTarget.blur()
                return
              }

              if (!showSuggestions) return

              const count = suggestions.length
              // step from the row that is actually highlighted, not from a
              // stale index left by a longer list
              if (event.key === 'ArrowDown' && count > 0) {
                event.preventDefault()
                setSelectedSuggestion((activeSuggestion + 1) % count)
                return
              }
              if (event.key === 'ArrowUp' && count > 0) {
                event.preventDefault()
                setSelectedSuggestion((activeSuggestion - 1 + count) % count)
                return
              }
              if ((event.key === 'Enter' || event.key === 'Tab') && count > 0) {
                event.preventDefault()
                const selected = suggestions[activeSuggestion]
                if (selected !== undefined) applySuggestion(selected.value)
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
              <p className="b-compose__suggestion-note">searching accounts</p>
            ) : (
              suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.key}
                  type="button"
                  role="option"
                  id={`${listboxId}-option-${index}`}
                  aria-selected={index === activeSuggestion}
                  tabIndex={-1}
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
      </search>
      {!wide ? (
        <div className="b-view__tools b-view__tools--profile">
          <fieldset className="b-view__pinned">
            <legend className="mono-label">search</legend>
            {SEARCH_MODES.map((option) => (
              <button
                key={option.mode}
                type="button"
                className="b-pinned-feed"
                data-active={option.mode === mode ? 'true' : 'false'}
                aria-pressed={option.mode === mode}
                onClick={() => {
                  chooseMode(option.mode)
                }}
              >
                {option.name}
              </button>
            ))}
          </fieldset>
        </div>
      ) : null}
      <div className="b-view__body">
        {inlineWarning}
        {wide && modeDeck ? (
          <div className="b-deck-stage" data-deal={dealMode === 'modes' ? 'true' : undefined}>
            <Deck
              key={`search-modes:${query}:${mode}`}
              items={SEARCH_MODES}
              getKey={(option) => option.mode}
              renderItem={(option) => (
                <ModeCard
                  label="search"
                  name={option.name}
                  description={option.description}
                  active={option.mode === mode}
                  countLabel={
                    modeCounts[option.mode] === null
                      ? null
                      : resultCountLabel(modeCounts[option.mode])
                  }
                  activeHint="current"
                  onSelect={() => {
                    chooseMode(option.mode)
                  }}
                />
              )}
              onActivate={(option) => {
                chooseMode(option.mode)
              }}
              onExitStart={() => {
                switchModeDeck(false)
                requestDeckFocus()
              }}
              leadingPeek={modeBack}
              leadingPeekInteractive
              initialIndex={modeIndex}
              label="search modes"
            />
          </div>
        ) : mode === 'posts' ? (
          <div className="b-deck-stage" data-deal={dealMode === 'results' ? 'true' : undefined}>
            <Deck
              items={posts}
              getKey={(post) => post.uri}
              renderItem={(post, index, focused) => (
                <PostCard post={post} index={index} focused={focused} onOpen={openThread} />
              )}
              onActivate={openThread}
              pending={feed.isPending && activeInfo === null}
              hasMore={feed.hasMore}
              loadingMore={feed.isLoadingMore}
              onLoadMore={feed.loadMore}
              loadMoreError={feed.loadMoreError}
              onRetryLoadMore={feed.retryLoadMore}
              label="search posts"
              stateKey={postsStateKey}
              empty={
                emptyQuery ? (
                  quietBand
                ) : activeInfo !== null ? (
                  <ErrorNotice
                    title={activeInfo.title}
                    message={activeInfo.detail}
                    retrying={failure.retrying}
                    onRetry={() => {
                      failure.retry(activeRetry)
                    }}
                  />
                ) : (
                  <EmptyState title="no posts found" hint="no posts matched this query" />
                )
              }
              {...(wide
                ? {
                    onExitStart: () => {
                      switchModeDeck(true)
                      requestDeckFocus()
                    },
                    leadingPeek: modePeek,
                    leadingPeekInteractive: true,
                  }
                : {})}
            />
          </div>
        ) : mode === 'users' ? (
          <div className="b-deck-stage" data-deal={dealMode === 'results' ? 'true' : undefined}>
            <Deck
              items={userResults}
              getKey={(user) => user.did}
              renderItem={(user) => <ActorCard actor={user} />}
              onActivate={(user) => {
                navigate(actorHref(user.handle))
              }}
              pending={users.isPending && activeInfo === null}
              label="search users"
              stateKey={deckStateKey}
              empty={
                emptyQuery ? (
                  quietBand
                ) : activeInfo !== null ? (
                  <ErrorNotice
                    title={activeInfo.title}
                    message={activeInfo.detail}
                    retrying={failure.retrying}
                    onRetry={() => {
                      failure.retry(activeRetry)
                    }}
                  />
                ) : (
                  <EmptyState title="no users found" hint="no accounts matched this query" />
                )
              }
              {...(wide
                ? {
                    onExitStart: () => {
                      switchModeDeck(true)
                      requestDeckFocus()
                    },
                    leadingPeek: modePeek,
                    leadingPeekInteractive: true,
                  }
                : {})}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}
