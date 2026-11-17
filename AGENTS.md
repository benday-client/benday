# agents

operating notes for changing benday. `README.md` describes the product for
readers; this file describes the implementation and the rules for editing it.
read the code first when the two disagree.

benday is a static react client for bluesky. there is no backend of this
project, no server-side proxy and no database. public reads go to the fixed
`https://api.bsky.app` origin; writes and account state go to the signed-in
account's pds. everything else is browser storage.

## layout and ownership

```text
src/
  main.tsx              react root; appStyles owns the stylesheet order
  App.tsx               query client, routes, tab order, global dialogs, theme
                        application, global hotkeys
  lib/                  framework-free logic and zustand stores
  hooks/                react/query glue around lib
  components/           presentation and interaction; Avatar owns the dithered
                        initial fallback
  components/ui/        dumb TUI primitives (Button, CardBack, Dialog, Frame,
                        ModeCard, ...) plus the shared FrameHead/FrameBody
  views/                route views: FeedView, SearchView, ProfileView,
                        NotificationsView, ThreadView
  styles/               fonts, tokens, base, layout, components, cards, dialogs,
                        account, views, search, notifications, compose, media,
                        dither, theme-effects, texture last
  test/                 fixtures, the jsdom setup, the browser setup and the
                        stage helper
vitest.browser.config.ts  the native chromium project (vitest browser mode)
public/                 favicon
```

routes: `/` and `/feed` render `FeedView`, `/search` renders `SearchView`,
`/profile/:actor` renders `ProfileView`, `/thread?uri=…` renders `ThreadView`,
`/notifications` renders `NotificationsView`, and anything else is the not-found
view. `TAB_ROUTES` in `App.tsx` is `['/feed', '/search', '/notifications']`;
search is a tab between feeds and notifications, and `/` or `s` still jump to
it from any route; a profile route is appended only while it is open.

`FeedView`, `SearchView` and `ProfileView` share one deck switcher: on wide
screens the content deck's leading peek card opens a second deck — the feeds
list, or the shared `ModeCard` modes — and choosing an entry
deals the content deck back. below 900px a narrow-only strip of `b-pinned-feed`
chip buttons switches modes and feeds instead. the 900 ms deal flash that carries
a deck swap is `useDealFlash` in `src/hooks/useDealFlash.ts`; each view keeps its
own modes and types.

ownership by concern:

- `src/lib/atproto.ts` owns read requests and mapping through
  `src/lib/model.ts`. components and views do not build read agents.
- `src/lib/auth.ts` owns the active agent, session persistence, pds resolution
  and sign-in/sign-out. `src/lib/identity.ts` owns the one handle-to-did
  resolution (trim, one leading `@`, a did passes through, the public resolver
  with its timeout) used by both the password path's pds discovery and the
  portal's login hint. `src/lib/oauth.ts` owns the loopback and configured hosted
  portal and indexedDB. `src/lib/oauthMetadata.ts` owns metadata, the scope and
  the canonical callback; `vite.config.ts` embeds the hosted client id and emits
  the metadata asset. do not create a second session path or handle resolver.
- `src/lib/actions.ts` owns writes: like, repost, reply, post, delete and
  feed feedback. `src/lib/profileActions.ts` owns follow, mute and block.
  `src/lib/actionStore.ts` owns optimistic like/repost state through one shared
  side transition: the same canonical read, one-write-per-uri lock and freshness
  policy, with side-specific fields and writes.
- `src/lib/queries.ts` owns invalidation policy; `src/hooks/useBskyQueries.ts`
  owns query keys and paging. changing cache behavior means changing both.
- `src/hooks/useRetainedError.ts` owns the first-load retry notice retention
  shared by search, feed, profile and thread: a visible failure stays mounted
  (and keeps its focused retry control) while its own retry runs, a repeat press
  during that fetch is ignored, and a changed request identity or successful
  data drops the capture.
- `src/lib/notifications.ts` owns notification mapping and seen updates;
  `src/hooks/useNotifications.ts` owns the notifications query.
- `src/lib/markdown.ts` and `src/lib/facets.ts` own composer marker parsing and
  facet rendering. do not duplicate byte-offset math in a component.
- `src/components/CommandPalette.tsx` owns palette commands (navigation,
  settings, help and account actions); `src/lib/command.ts` only parses
  `@handle`, post `at://`, `#tag` and plain-text jumps. a feed-generator `at://`
  falls through to search text instead of opening a feed. the results area is a reserved
  box (`min(46vh, 21rem)`) so the centred dialog cannot resize while the
  debounced suggestions arrive or between result shapes, and selection scrolling
  adjusts only the list's own `scrollTop` — never `scrollIntoView`, never the
  dialog or the document. pointer hover may only take selection over on real
  movement (compare the event coordinates), because scrolling the list under a
  parked cursor fires mouseenter on a different row and pulls the keyboard
  selection back. stored jump history is sanitized on read: only a same-origin,
  same-protocol destination survives, stored back as path+query+hash, so a
  protocol-relative, backslash-authority or blob: entry is ignored instead of
  becoming a route.
- `src/lib/themes.ts` owns the light/dark browser chrome colours; the settings
  store derives the active scheme from the appearance mode. `tokens.css` owns
  colour, typography and spacing roles; `theme-effects.css` owns dialog arrivals
  and `texture.css` owns the body fringe and scanline field.
- `src/lib/settingsTransfer.ts` owns the export/import file format and
  validation; `src/lib/store.ts` owns the persisted settings store.
- `Deck` owns focus, scroll position memory and deck-local keys. the saved
  position carries the deck's axis and the focused card's key, so a list that
  grows or shrinks around it restores the same card (the index is only the
  fallback for a card that left); restoring it on the other axis re-centres
  through `scrollToIndex` instead of reusing foreign offsets. Views describe
  their cards; `Deck` moves between them. there is no `footer` prop: a card back
  that needs controls is an article, and a mode back is one native button. an
  empty deck keeps the half-neighbour spacers and centres its empty slot like a
  first card, so the leading peek stays half visible. the peek is never a snap
  target (`scroll-snap-align: none` on `.b-deck__peek`) and the half-neighbour
  spacers key on real cards (`:not(.b-deck__peek)`), so a deck showing only the
  peek and skeletons stays left-aligned instead of centring the switcher while
  the first page loads. a deck that re-centres from its scroll origin (login
  swaps, a stored offset reset) does it before paint; user moves stay animated.
- `src/test/fixtures.ts` and `src/test/setup.ts` support tests; shared view
  shapes belong in the fixtures file.

views are default exports; components are named exports. keep the `components/ui`
layer dumb and token-driven, and put scheme overrides in the effect layers
(`theme-effects.css`, `texture.css`) rather than scattering `[data-theme]`
selectors.

## setup and commands

the repository is developed in a fedora toolbox named `benday`, with pnpm as the
only supported package manager (`pnpm-lock.yaml` is present and `package.json`
declares `pnpm@12.16.1`). node must satisfy `^22.22.2 || ^24.15.0 || >=26.0.0`.

```sh
toolbox create benday
toolbox run -c benday sudo dnf install -y git nodejs npm
toolbox run -c benday sudo npm install -g pnpm@12.16.1
toolbox enter benday
cd ~/repos/src/lexa/benday
pnpm install
pnpm dev
```

if you are already inside the toolbox, omit the `toolbox run -c benday` prefix
and run pnpm directly. outside the toolbox, `corepack enable pnpm` at the
repository root provides the pinned pnpm, and `pnpm exec playwright install
chromium` (or the distribution's chromium libraries) satisfies the browser
suite. the gate has three prerequisites: node with the pinned pnpm on `PATH`,
the playwright chromium download, and a git checkout. a missing one is a hard
failure, never a skipped check.

```sh
pnpm dev        # vite on 127.0.0.1:5173, strict port
pnpm build      # tsc --noEmit then vite build into dist/
pnpm preview    # static preview on 127.0.0.1:4173, strict port
pnpm typecheck  # strict tsc pass
pnpm lint       # biome check .
pnpm format     # biome check --write .
pnpm test:quality # node --test over scripts/ (the gate's own checks)
pnpm test         # vitest run, offline jsdom tests
pnpm test:browser # vitest browser mode in real chromium
pnpm check        # lint, quality scripts, both suites, then build
```

`pnpm check:assertions` scans existing tracked and untracked typescript files.
deleted tracked paths are skipped; explicitly named missing files still fail.

`node scripts/check-staged.mjs` runs that same `pnpm check` against the index
rather than the worktree: it exports the staged tree into a temporary
repository, installs from the frozen lockfile and gates that copy, so an
unstaged dependency cannot make a partial commit look green. it refuses
unmerged entries and intent-to-add paths, reads the original repository with
`GIT_OPTIONAL_LOCKS=0`, and never resets, stashes or borrows `node_modules`.
`.pre-commit-config.yaml` installs it as the `benday-check` hook through
pre-commit's native node support:

```sh
python3 -m venv ~/.local/share/benday-pre-commit
~/.local/share/benday-pre-commit/bin/pip install pre-commit
~/.local/share/benday-pre-commit/bin/pre-commit install
```

the hook is local and bypassable; it is not remote enforcement, and no forge
runs `pnpm check` for this repository.

open the dev server at `http://127.0.0.1:5173/` for the portal flow, or at
`localhost` for the password form. vite and preview bind the loopback address
only, so the dev server is never reachable from another host.

the target production origin is `https://benday.qex.at`, serving `dist/` from
the origin root; `BENDAY_PUBLIC_ORIGIN` overrides it for another deployment. dns
must resolve that hostname to the static host, with a valid tls certificate.
deployment must serve real assets and oauth metadata before the html fallback;
metadata is a public `application/json` response, never the app shell. `/feed`
is the canonical oauth callback and must serve `index.html` on a direct request,
preserving its query string. the other client routes also need the html fallback.
the metadata response must be `200` directly, without a redirect; a redirect
breaks client metadata resolution.
verify those http responses on the deployed host; vite preview only proves the
local bundle and cannot establish that production routing or dns works.

build the hosted portal configuration with:

```sh
BENDAY_PUBLIC_ORIGIN=https://benday.qex.at pnpm build
```

an unset origin builds for `https://benday.qex.at`. the origin must use https
without a path, query, fragment, credentials or nondefault port. every build
emits `dist/oauth-client-metadata.json` and embeds that asset's absolute url as
`import.meta.env.BENDAY_OAUTH_CLIENT_ID`. deploy metadata and app together.
changing the host environment after the build does not reconfigure the bundle.

live deployment verification is pending: `benday.qex.at` did not resolve from the
development environment on 2026-11-17. after dns and hosting are configured,
check the public metadata and `/feed` responses, then portal sign-in and restore
after a reload. never report a local preview check as a live portal check.

before handing off a change, run the narrowest check that covers it, then
`pnpm check` unless the task explicitly says not to run gates. tests are offline
and must not require a pds, appview or network.

## quality contract

these rules are enforced where a check can enforce them and reviewed where it
cannot. human review still owns design, intent and semantic readability, and the
staged gate below is local: it can be bypassed and no remote service runs it.

- render stays pure. components and hooks derive values during render and push
  effects to browser, network and storage boundaries (subscriptions, storage
  writes, document attributes). an effect never exists just to copy state into
  state or to mirror a prop.
- shared inputs are immutable. props, cached query data and store snapshots are
  read, never mutated. mutating local state and looping over values the code
  owns are fine.
- async completions own their request and account. a completion checks that its
  epoch, token, viewer or composition still owns the surface before it writes
  state, closes a dialog, dismisses a card or clears a draft.
- degradation is explicit and best effort. an optional read (seen marker,
  identity display, jump history, partial hydration) may fall back, but the call
  site says why, and a visible failure is never rewritten as a silent success.
- tests describe behavior: outcomes, boundaries, ownership, transitions and
  errors. they do not echo display copy, source text, default values or a
  component tree, and a copied label or colour table is not a test.
- spacing is semantic. blank lines separate input normalization, derived models,
  early returns, async boundaries and the final render; they do not decorate
  every statement.
- visual references are source-backed. tokens cite the inspected source; light
  mode and accessibility adaptations are Benday's, not upstream palette claims.
- types are not laundered. `pnpm check:assertions` parses every tracked and
  untracked source file and rejects an outer assertion whose inner assertion
  erased the type through `unknown`, `any` or `never`, including parenthesized,
  commented, multiline, angle and tsx forms. `suspicious.noExplicitAny` is an
  error. there is no suppression comment, no unchecked generic conversion
  helper and no fake-agent object standing in for a typed boundary; narrow with
  `isRecord` or a named predicate and construct the real SDK object instead.
- the gate is the staged snapshot. `pnpm check` (biome, the assertion gate, the
  quality scripts, both suites and the build) must pass, and the committed tree
  is the indexed tree, verified through `scripts/check-staged.mjs` as described
  in setup.

## auth and privacy boundaries

- the public surface is the beta page: apache basic auth now covers only
  `/admin`, and `/oauth-client-metadata.json` stays public because the pds
  fetches it during portal sign in.
- access is the shipped list at `public/beta/invites.json`, checked after a sign
  in commits; an unlisted account is refused and signed out locally, and an
  unreadable list fails closed. its `sha256` array holds lowercase hex SHA-256
  digests of exact UTF-8 DIDs, with no prefix, salt or normalization. handles
  are never membership keys: `/admin` resolves them through `identity.ts` first.
  hashes are obfuscation, not secrecy: a known DID's membership is guessable
  by hashing it. this is a social door, not a security gate; the static client
  check cannot stop a modified client. sessions remain the visitor's own pds.
- `https://benday.qex.at/admin` mints a digest and quoted JSON entry, not a
  password. add the entry to the shipped array and republish to invite; delete
  it and republish to revoke. minting changes no published access. there is no
  worker or expiry.
- apache basic auth protects only `/admin`. `BETA_HTPASSWD` supplies its admin
  credential file, published to the account home's `.benday-htpasswd`, outside
  the webroot, not `dist/`. it is unrelated to beta membership.
- `public/.htaccess` is the only source for serving rules; it ships in `dist/`.
  publish substitutes `__HOME__` with the absolute account home (falling back
  to the remote working directory when HOME is unset) for `AuthUserFile`.
  dotfile requests are denied before the app fallback. edit that source, never
  a deployed copy, and never add a second one.
- there is no first-party server. never add an endpoint that receives sessions,
  passwords, drafts or settings.
- browser storage keys are fixed: `benday:settings` (appearance mode and keyboard shortcuts),
  `benday:session` (password-session tokens), `benday:drafts` (composer drafts)
  and `benday:jump-history` (last five palette jumps). portal oauth state lives
  in the browser's indexedDB. do not rename or reuse these keys without a
  migration.
- the password is passed to the api once and never persisted. password sessions
  store the sdk session in localStorage; portal sessions are managed by
  `@atproto/oauth-client-browser`.
- portal login uses `atproto transition:generic` on `127.0.0.1` and `[::1]`
  and on the exact https origin baked into the build (`benday.qex.at` by
  default, or `BENDAY_PUBLIC_ORIGIN`). the hosted client id is that origin's
  `/oauth-client-metadata.json` url and never follows the active route; tokens
  are bound to that identity. both client types return to the canonical `/feed`
  callback.
- `localhost` and every origin other than the baked one keep the password
  fallback. `localhost` deliberately avoids the oauth client's loopback rewrite,
  which would orphan that origin's stored session and settings.
- the portal answers in the url fragment (`response_mode=fragment`), so `code`,
  `state` and callback errors never reach the host. `client.init()` validates
  and exchanges the fragment, then clears only the fragment: a query-shaped
  `code`/`state` is not a callback and keeps its query and anchor, and a rejected
  fragment is consumed while the query string survives. keep the fragment-mode
  regression in `src/lib/oauth.test.ts`; a query-only probe does not exercise it.
- sign-out revokes the portal session, logs out the password agent, clears
  `benday:session` and resets per-post action state. a stale restore must not
  overwrite a newer sign-in; keep the `authEpoch` guard and the action-store
  subscription in `src/lib/actionStore.ts`.
- a restore keeps the session the sdk retained: transient, network and
  non-expiry failures leave the session in place, only a rejected refresh token
  clears it, and a retained session is committed as authenticated. a failed
  portal restore is reported as its own `restoreError` notice above the route
  and cleared by an explicit sign-in, sign-out or `clearError`; a successful
  password fallback never erases it, and it never opens a dialog.
- a password candidate that loses the epoch after its own login revokes that
  session best effort before returning false; the cleanup is candidate-local and
  never touches the committed account.
- content reads go to `https://api.bsky.app` with the signed-in account's labeler dids
  through the `accept-labelers` header; search terms and labelers are visible to
  that host. writes go through the account's pds. viewer-state reads and pinned
  generator metadata use the canonical `bsky_appview` proxy
  (`did:web:api.bsky.app`). feed feedback goes through the pds to the serving
  generator's did (`atproto-proxy: <did>#bsky_fg`).
- `benday-settings.json` is version 3 and contains only `version`, `exportedAt`,
  `appearance`, `keyboardShortcuts` and `imageEffects`. version-1 and version-2
  files are still accepted; retired fields are ignored. it must never
  contain tokens, passwords, indexedDB state, drafts, jump history, profile
  relationships or any other auth material. unknown keys and every retired field
  are ignored; keep it that way.

## data flow

reads:

1. `createAgent()` builds an `AtpAgent` for the fixed appview origin and applies
   the signed-in account's labeler header.
2. `fetchFeedPage` chooses `getFeed`, `getAuthorFeed` or `searchPosts`; pinned
   feeds use the signed-in agent when one exists so JWT-gated generators can
   answer.
3. `mapFeedViewPost` / `mapPostView` / `mapProfile` / `flattenThread` in
   `src/lib/model.ts` produce the view models in `src/lib/types.ts`. components
   consume only those models. the sdk validates the outer response, but a post
   `record` and a quoted `value` are lexicon `unknown`: `readPostRecord`
   projects text, facets and reply refs from unknown, and `mapFacets` validates
   the array, each byte range, the feature list and every typed payload.
   malformed content stays empty (or its feature is skipped) and is never
   asserted into a full SDK record.
4. search, feed and profile cards carry no parent preview and make no
   reply-parent enrichment request; thread reads use `getPostThread` with depth
   3, parent height 6 and a flattened cap of 80 entries. hidden-author and
   notification-subject hydration start their 25-item batches together with
   `Promise.allSettled`, merge in chunk order and keep the batches that answered;
   a failed batch only leaves its own rows without context.

writes:

- `actions.ts` and `profileActions.ts` use `getAuthAgent()`. signed-out calls
  either throw or are gated in the component before they are attempted.
- writes that change records outside the feed (post, reply and delete)
  call `invalidateNonFeedQueries(queryClient)`. the stable roots it leaves alone
  are `feed` (an explicit-refresh deck), `pinned-feeds` (settings keyed by their
  own inputs) and `account-labelers` (the account's own preference read);
  everything else is invalidated.
  likes, reposts and profile relationship changes update their local stores or
  profile query instead.
- a composed post or reply clears its draft and invalidates non-feed
  queries. it does not navigate to a thread that may not be indexed yet.

query keys and policy:

```text
['feed', 'author', actor, viewerDid | 'anonymous']
['feed', 'search', query, viewerDid | 'anonymous']
['feed', 'feed', uri, viewerDid | 'anonymous']
['search-actors', query]
['profile', actor, viewerDid | 'anonymous']
['thread', viewerDid | 'anonymous', uri]
['pinned-feeds', did]
['account-labelers', did]
['notifications', 'list', did | 'anonymous']
['actor-suggestions', query]
```

the feed infinite query uses `staleTime: Infinity`, `retry: false`,
`refetchOnMount: false`, `refetchOnReconnect: false` and
`refetchOnWindowFocus: false`. its explicit refresh is
`resetQueries({ exact: true })`, which drops pages and resets to the first page;
further paging belongs to the intersection sentinel. the query client defaults elsewhere are 45s stale time,
one retry and no window-focus refetch.

do not add implicit feed refreshes. switching tabs, restoring a cached deck,
switching to another account and finishing a write all leave feed cards alone. the
explicit reloads are the two-step `R` or narrow refresh button in the feed view,
the refresh card at the end of a profile deck, and submitting the same search
again. notifications are the one view that refetches on mount and reconnect by
design.

account-scoped reads are bound to the owner their key names:
`requireViewerAgent(viewerDid)` (in `src/lib/auth.ts`) throws
`account changed before the request could be sent` when the active account
moved, instead of borrowing it. profile fetches merge the fixed host's public
fields with the account's canonical-proxy viewer state, and only when both agree
on the did.

`ProfileCard` patches only `['profile']` entries whose key carries the same
captured viewer and whose data has the same did, through `setQueriesData`, so a
relationship change stays within one account and never crosses into another
viewer. an action that settles after the account or profile changed
patches nothing and shows no error.

## profile model, actions and modes

`ProfileView` (`src/views/ProfileView.tsx`) fetches one author feed with
`filter: 'posts_with_replies'`. `mapProfile` keeps pronouns, links, labels, bot
status and the full viewer state. `ProfileCard` renders the identity and owns the
actions; it never fetches a second profile shape.

- actions: follow/unfollow, mute/unmute and block/unblock.
  mute, unmute and unblock apply an optimistic viewer patch;
  follow/unfollow and block wait for the server result. any failure restores the
  previous viewer state and shows the error inline. per-profile activity
  subscriptions are no longer editable, but stored subscription state and its
  read badges stay truthful.
- `mutedOnlyReposts` is applied twice: the profile deck filters reposted entries
  out client-side, and the relationship tag says `reposts hidden`.
- `mutedOnlyQuoteposts` is an independent scope, so `quoteposts hidden` shows on
  its own.
- a failed action restores only the keys present in that action's optimistic
  patch; actions with no optimistic patch (follow, unfollow, block) never touch
  the cache, so a newer fetch is never rolled back.
- external profile links are rendered only for `http:` and `https:` urls, open
  in a new tab and fall back to the hostname when the title is empty.
- modes are `profile`, `posts`, `replies` and `media`
  (`src/lib/profileModes.ts`). the three content modes are client-side filters
  over the loaded author pages: standalone non-reply entries, replies authored
  by this account, and the author's own entries with image or video embeds,
  excluding repost entries. empty states describe what has been fetched, not
  the whole account.
- the profile switcher uses that shared deck with `ModeCard`s
  (`src/components/ui/ModeCard.tsx`) and a `CardBackButton` peek; `profile`
  shows only the identity card and the content modes show their post cards. the
  deck key carries actor, mode and viewer, so switching starts at the first card
  without leaking another viewer's deck. every content mode
  ends in a `{ kind: 'refresh' }` item rendered by `RefreshCard`, which reloads
  the author feed through `retry()` and never opens a thread; a blank first page
  shows only its loading card.

## notifications

`NotificationsView` is signed-in only. `fetchNotifications` asks the pds for the
latest 50 notifications; `mapNotification` keeps reason, actor, subject, subject
text, read state and index time. `notificationReasonGroup` and
`notificationReasonLabel` map follow, like, like-via-repost, repost,
repost-via-repost, reply, mention and quote, label a few newer reasons, and fall
back to a generic label. `notificationSubjectHref` links a follow to the actor
profile and only post at-uris to `/thread?uri=…`. the target depends on the
reason: a reply, mention or quote opens the notification's own `uri` (the new
post), while a like or repost opens `subject` (the reader's post). the wire
`subject` of a reply is the parent, so using it there sends the reader to the
wrong post. rows render as frame cards (head with the reason, body with actor and
preview, footer with the open affordance) so the list reads like the decks.

opening the view marks the list seen once per did using the newest indexed time
of the unfiltered wire page, so a hidden newest row still advances the cursor.
subject hydration asks `getPosts` only for post at-uris: a starter pack or
profile subject keeps its row and gains no subject post.
`markNotificationsSeen` is best effort and must never block or fail the list.
there is no paging, no realtime subscription, no header count and no refresh
control; the query's mount/reconnect refetch and the error-state retry are the
only reload paths.

## inline reply composition

`src/lib/ui.ts` holds the mutually exclusive UI state: `dialog`, `compose` (the
dialog request) and `inlineCompose` (the dock request). opening one closes the
other two.

every reply action on a post opens that post's thread and focuses its inline
composer when ready; there is no reply dialog and no quote composer.
`ThreadView` renders `InlineComposer` only when the request targets the focused
post, in a dock below it. escape closes the dock and `ctrl`/`cmd` + `enter`
submits. the standalone composer remains a dialog for original posts.

both paths render the same target line through `ComposeTarget` in
`ComposeField.tsx` and share `useComposeForm`: 300 graphemes counted on literal
text, labelled-link facets from `src/lib/markdown.ts`, `@` account suggestions,
per-account drafts, the `createPost` / `createReply` helpers and the same
post-send invalidation. bold, italic, strike and inline-code markers stay
literal text; incoming style facets still render. reply records carry
`reply: { root: post.replyRoot ?? parent, parent }`. the thread view also shows
an `in reply to @handle` link above the focus card when the appview supplied a
parent.

draft keys are `${accountDid}:post` or `${accountDid}:reply:${targetUri}`; a
composition without an account writes no key. at most 20 drafts are retained,
oldest evicted first. startup deletes `signed-out:` and `:quote:` records once,
and unreadable storage deletes nothing. `readDraft` returns `{ text, revision, available }` and
`writeDraft` returns `{ ok: true, revision }` or `{ ok: false }`:
`src/lib/drafts.ts` never reports an inaccessible store as an empty map,
because a following write would then erase every other account's drafts.
malformed json or a wrong top-level value stays an available empty map, and a
map write that storage rejects reports failure instead of pretending success.

every open composition owns its key, text, timer and two snapshots: `saved`
(the revision and text of its last accepted write) and `readSnapshot` (what was
on disk when it opened, kept even when the opening claim fails). a successful
send clears exactly `saved ?? readSnapshot`, never the submitted text, so an
older autosave with different wording is still removed and a same-text reopened
draft is not. when no snapshot exists, cleanup succeeds only if the opening
read was available. cleanup failure keeps the composition open with `sent`:
the textarea is read-only, submission never sends twice, the primary action
reads `sent`, the ghost action reads `close`, and closing it never autosaves
again. a storage read or save failure shows
`draft storage unavailable · keep a copy before closing` and a successful save
clears it; state from a storage result is only reported while that composition
still owns the surface.

## dialogs and form ownership

- a dialog dismisses from a real backdrop press only: the click handler requires a
  `pointerdown` whose target was the dialog element, so a text selection that
  starts inside and ends on the backdrop cannot close it.
- `LoginDialog` owns a monotonic opening token captured at submit and bumped on
  every open and close. a completion may only close or clear fields while it
  still owns the same opening, and the error line is gated on an attempt started
  in the current opening, for the password and portal paths alike.
- `useActorSuggestions.insertSuggestion` is the single replacement rule for both
  the composer and the search field: it preserves the suffix byte-for-byte,
  reuses an existing leading whitespace run (never splitting CRLF) and only adds
  a space at the end of the text.
- `useActorSuggestions.buildSuggestions` is the single shaping rule for the
  composer, the search field and the palette: fetched accounts when they
  answered, a nonempty literal token otherwise, and nothing for an empty mention.
  hashtags are never suggested; typed `#tag` text searches as text. arrow steps
  start from the clamped active row, so a settled list that shrinks never wraps
  from an index the reader cannot see.

## themes and surfaces

Benday adapts the visual language inspected on [doll.systems](https://doll.systems/),
including its home, maintenance article, about, latest and colophon pages on
2026-11-17. the source stylesheet is
`https://doll.systems/_astro/LinkGraph.CdnPADRq.css`. Benday uses its own
typography stack and content, not the reference's brand, artwork, graph or
article text. light mode, the readable status roles and the calmer light texture
are Benday adaptations.

- appearance is `light`, `dark` or `system`; system follows
  `prefers-color-scheme`. the store derives the active `theme`, a fresh state
  starts at `system`, and `App.tsx` writes `data-theme` and the `theme-color`
  meta tag together. `index.html` resolves the same preference before hydration.
  no palette picker, aliases or retired palette-to-mode map remain.
- `tokens.css` owns the two schemes and their semantic text/fill roles. both are
  neutral, with the light tokens warm and the dark tokens near-black; violet is
  only an accent (`--accent`, `--accent-hover`). `--ink-heading` is the elevated
  heading ink, `--ink` the body ink and `--ink-dim`/`--ink-faint` the muted
  roles. muted copy is deliberately brighter than the reference's decorative
  gray so small UI text remains readable. nested scheme scopes reset their
  colour roles.
- type is three faces on one spine. `--font-display`, a regular serif, sets
  headings at `--text-headline` 64, `--text-title` 36 or `--text-subtitle` 24;
  headings carry `--ink-heading`, zero `letter-spacing` and `--leading-heading`,
  except the gate headline which uses `--leading-display`. `--font-reading` sets
  reading text at `--text-reading` 18 over `--leading-reading` 1.4. `--font-mono`
  sets chrome — navigation, timestamps, handles and action labels — at
  `--text-chrome` 12 over `--leading-chrome` 20; tracked uppercase labels are
  the exception, never headings. below 600px reading text is 15px and the
  gutter 1.5rem without changing reading order or deck behavior.
- spacing is the 4/8/12/16/24/32/48/64 ramp from `--space-1` through
  `--space-8`. `--page-gutter`, `max(2rem, (100vw - 83rem) / 2)`, is the one
  horizontal origin for the top bar, the gate card and every route column; no
  shell rule computes its own inset. the reading column centres at
  `min(100%, var(--measure-reading))` (40rem) within it.
- square surfaces use neutral hairlines, not head washes or glow. focus keeps
  the inset double hairline on deck cards and a visible violet outline on
  controls. the active tab uses a restrained tinted field; engaged actions keep
  their underline so state never relies on colour alone.
- static imagery and video posters use the one monochrome grunge/Bayer filter
  in `DitherDefs.tsx` and `dither.css`. `imageEffects` is on by default; off,
  `DitherImage` emits `data-effect="none"` and imagery paints plainly, and
  playing video frames are never filtered. a decoded bitmap reveals over
  `--dither-swap` (320ms) in `steps(3, end)`, from opacity 0 and scale 1.02,
  and reduced motion drops the reveal.
- motion is step-only. `--motion-ease` is `steps(4, end)`; UI transitions and
  arrivals use `--motion-dur` (160ms), while deck deals and the dither reveal
  use 320ms (`--deal-dur`, `--dither-swap`). route, dialog and deck arrivals
  stay quiet, with no springs or per-scheme choreography. reduced motion
  collapses transitions and animation in `base.css`; dialog dismissal keeps its
  transition completion and timeout fallback.
- `texture.css` carries the reference's CRT residue last in the cascade. every
  body line takes a fixed 1px chromatic fringe from a warm and a cool tint;
  display faces — headings plus card, name and dialog titles — take a stronger
  pair. a fixed, non-interactive `body::after` scanline field sits at z-index 30:
  above the app shell and content, below native dialogs in the top layer. light
  mode uses calmer tints and a near-transparent scan dark. nothing here
  animates, so the static texture survives reduced motion.
- settings and keyboard help keep their searchable sections. settings contains
  only appearance mode, keyboard shortcuts, dither effects, account and transfer.
- change `Theme`, `themes.ts`, the `index.html` colour table, `tokens.css`,
  `texture.css`, `DitherDefs.tsx`, `dither.css`, `appStyles.ts` and the real
  appearance/contrast contracts together. do not add tests that merely pin a
  swatch table or visual copy.

## settings transfer

`src/lib/settingsTransfer.ts` defines the version 3 file:
`{ version, exportedAt, appearance, keyboardShortcuts, imageEffects }`. export
is built from exactly those portable preferences, so extra properties cannot
leak. `importSettings` applies the mode, the shortcut flag and the dither flag
in one `set` and recomputes the derived theme, so malformed input leaves
settings untouched.

normalization rules to preserve:

- version 3 is current. versions 1, 2 and 3 are accepted; anything above 3, a
  missing or non-integer version, a non-object or malformed json is rejected with
  a truthful message.
- a valid `appearance` wins; missing or unusable modes become `system`. retired
  palette names have no effect on first paint, stored settings or imported files.
- `keyboardShortcuts` is the boolean when present, otherwise `true`; an explicit
  boolean `imageEffects` is honored, otherwise it defaults to `true`.
- every retired field is ignored, including `theme`, `lightTheme`, `darkTheme`,
  `highContrast`, `appView`, `labelers` and credential-shaped keys.
- store persistence is version 3. `migrate` maps version-1 and version-2
  documents through the same rules, then drops every removed field.
  `partialize` writes `appearance`, `keyboardShortcuts` and `imageEffects`; the
  active theme is derived, `merge` validates the three fields and defaults to
  system/true/true.
- the settings dialog enforces a 256 KiB bound before reading a picked file and
  applies the parsed result atomically. errors stay inline and the file input is
  cleared after a pick so the same file can be retried.

## keyboard model

there are five key layers, and they must not fight:

0. single-key shortcuts obey the `keyboardShortcuts` preference (default on).
   `characterShortcutAllowed(enabled, event)` from `src/lib/keymap.ts` is the
   one guard: it allows every ctrl/meta/alt chord and non-character keys and
   rejects bare keys in the `characterShortcuts` registry set when the
   preference is off. it is called first in `useHotkeys`, `Deck`, both
   `PostCard` handlers and the three `ThreadView` handlers, so a new bare
   letter binding must go through it too.
1. `useHotkeys` (`src/hooks/useHotkeys.ts`) is installed by `AppShell` only when
   no dialog, compose dialog or inline composer is open. unmodified keys belong
   to a focused field; a chord carrying ctrl, meta or alt may fire from it. it
   also ignores repeats, handled events, IME composition and modifier
   combinations unless the binding asks for `ctrl`/`cmd`. keys come from the one
   registry in
   `src/lib/keymap.ts`: `ctrl`/`cmd` + `k` palette (a toggle), `/` search with `s`
   as an alias, `c` compose and `,` settings. `?` is not a hotkey: the
   hold-to-reveal overlay in `src/components/KeyHints.tsx` owns it (tap opens
   help). settings and help each own a `/`-focused search field. escape is not
   one of these; it has its own listener in `AppShell` (see 6).
   on the closed-beta landing page only the registry-backed settings shortcut
   is enabled. tap/hold `?` and app commands stay off; the same preference,
   editable-field, modal and IME guards still apply.
2. tab switching is a separate capture listener in `App.tsx` for the platform
   primary modifier + left/right (meta on macOS, ctrl elsewhere); the chord may
   fire while a field has focus. tabs are `/feed`, `/search` and `/notifications`,
   in that cycle order; a `/profile/…` route is appended as a temporary tab while
   it is open. search is a tab and a route, also reached by `/` or `s`.
3. a shortcut that belongs to a card or a thread yields to any interactive
   control **outside** that surface: `isInteractiveTarget` from
   `src/hooks/useHotkeys.ts` plus a containment check, so a focused top-bar
   button or link keeps its native Enter/Space/arrows. a control inside the
   surface keeps its existing exceptions (a link or an editor suppresses the
   shortcut; an in-card button does not).
4. `Deck` listens on window and owns card movement. arrows follow the deck axis:
   on a wide deck `←`/`→` are previous/next and `↓` opens; on a narrow deck
   `↑`/`↓` are previous/next and `→` opens. the deck has no letter movement:
   `h`, `j`, `k` and `l` are inert on both axes. the back key (`←` wide, `↑`
   narrow) leaves at index 0 once per press, including on an empty deck. `home`/`end` are canonical
   first/last with `g`/`G` as aliases. `1`-`9` are 1-based and act whenever the
   deck is the active surface and the target is not interactive. `enter`
   activates on every deck; `↓` also opens on a wide deck and `→` on a narrow
   one. `ThreadView` owns thread tree movement: `←` leaves through the shared
   app-history back step, `↓` walks the replies in pre-order (a child first,
   then the next visible reply), and `↑` moves to the parent reply. at the focus
   post `↑` is swallowed: it never navigates or opens the parent thread, and `p`
   is the only parent opener. `j`/`k` keep flat reading order. page
   up/down and shift-arrows scroll the focused post body; shift-arrows stay owned
   at a boundary, plain page keys release.
5. view-local handlers add the rest: `PostCard` handles `f`, `b`, `r`, `y`, `m`,
   `v`, `x`, `o`, `+`, `-` and the `d` delete arm (confirm with `enter` or `d`,
   4s disarm, `esc` cancels) only while focused and unmodalled; `FeedView` owns
   the two-step `R`; `ThreadView` owns reply focus with child/parent arrows, flat
   `j`/`k`, `home`/`end`, `←` back and `p` for the parent post; `MediaViewer`
   owns `←`/`→`, `home`/`end` and the digit positions. every layer
   ignores dialogs, open composers, editable targets, IME composition,
   `event.defaultPrevented` and repeats. the hold-`?` overlay only reads
   `data-keyhint` attributes, never passes a key through, and hides on any other
   keydown.
6. escape has one precedence stack, top to bottom: an IME composition claims
   nothing; an open native dialog closes; the composer's suggestion list closes
   only itself; the inline dock closes and keeps its draft; a mode switcher
   closes and keeps the route; the search field clears its query and then blurs
   to the results; and `AppShell` steps back — from a thread, from a profile, or
   from search/notifications to the tab it was opened from. a feed deck has
   nowhere above it, so escape never leaves it. the feed, search and profile
   mode switchers register their Escape handler on window in the capture phase,
   guarded by `event.defaultPrevented`, `uiOwnsKeyboard()` and an open
   `dialog[open]`, so the switcher closes before `AppShell`'s bubble-phase
   listener runs. that listener is registered directly against
   `bindingFor('back')` rather than through `useHotkeys`, because it must also
   close a dialog while the key layer above it is disabled.

`PostCard` is memoized and its view callbacks take the captured post or uri
(`onOpen(post)`, `onDismiss(uri)`, `onFeedback(post, event)`), with the view owner
memoizing them, so a deck move re-renders only the two cards whose focus changed
instead of every loaded card. it also owns a layout-lifecycle token keyed by post
uri and account did. an
identity change or unmount invalidates it, clears the copy, feedback and
delete-arm timers and resets the local surface before paint; every async
continuation checks the token after its await and in its finally/timer
callbacks, and a completed remote delete still invalidates the reads it
changed. `v` and its overlay hint exist only when a bare or quoted video has a
non-null playlist.

`o` only acts when the focused post has a quoted post. `d d` only appears for
the signed-in account's own post records and arms on the first press. `R` arms a
five-second refresh confirmation and a second press resets the feed; it does
nothing while that refresh is still running. the media viewer has no letter
movement.

## tests and verification

the suite is vitest with jsdom, testing library, `css: true` and
`restoreMocks: true`. setup lives in `src/test/setup.ts` (hygiene in
`src/test/hygiene.ts`), shared shapes in `src/test/fixtures.ts`. tests are
co-located as `*.test.ts` / `*.test.tsx`. `pnpm test` reports the current file
and case counts, and the README names commands rather than numbers. setup clears
localStorage, installs a rejecting fetch stub and fails a
test that leaves an unexpected request on it, and `src/test/queryClient.ts`
hands out tracked clients (no retries, zero gc time). tests that exercise
transport replace the stub with deterministic routes
(`src/test/transport.ts`), which also records outbound request headers.

native-browser specs are `*.browser.test.ts(x)` and run only through
`vitest.browser.config.ts` (`pnpm test:browser`): vitest browser mode with
`@vitest/browser-playwright`, real chromium, the production stylesheet order and
`src/test/browserSetup.ts` (root attributes, stores, selection and key listeners
reset between cases). both import `src/appStyles.ts`, so painted geometry and
colour are measured through the production cascade, and `src/test/colors.ts`
resolves any browser-supported colour to its painted 8-bit sRGB pixels instead of
comparing serialization strings. they exist for behavior jsdom cannot judge: real layout,
trusted keys, native selection and computed styles. `src/test/stage.tsx`
gives them the definite-height app shell. `@vitest/browser-playwright@5.0.5`,
`playwright@1.64.1` and the chromium download are the only browser
prerequisites; a missing browser is a failure, never a skip. `pnpm check` runs
biome, `scripts/` under node's own runner, jsdom, browser and build in that
order, and `scripts/check-staged.mjs` runs the same chain against the index.

what the suite covers, and what it does not:

- covered offline: facets and byte offsets, anchor composition, post/embed/profile
  mapping, label filtering, markdown limits and wire facet canonicalization,
  thread flattening, time, dither generation, light/dark appearance, pinned-feed
  preferences and selection, account suggestion freshness, command parsing,
  palette precedence, auth transitions and did:web discovery, action auth gates
  and per-side action freshness, focused-card shortcuts including quoted-post
  opening, inline reply composition and its draft revisions, the feed cache
  guard, per-account read privacy, notification mapping, the viewer-state proxy,
  feed feedback, the account labeler handoff and settings version-3 import,
  v1/v2 migration and the dither-effects preference.
- not covered by unit tests: the profile action buttons' full optimistic cycle,
  real pds writes, the portal redirect and browser layout. those are checked
  manually against live hosts. do not claim a live check you did not perform.

when behavior changes, keep `README.md` honest and add or adjust a focused test
in the nearest existing file rather than creating a parallel suite.

## commits and file edits

- write in the existing lowercase editorial voice. UI labels, docs and commit
  subjects are lowercase; code identifiers follow the TypeScript conventions.
- biome formats with two spaces, single quotes, no semicolons, trailing commas
  and a 100-column line. run `pnpm format` or `pnpm lint` rather than hand
  fighting it.
- commit subjects follow the log: `feat: add …`, `fix: stop …`,
  `test: cover …`, `docs: …`, `refactor: …`. one concern per commit, imperative
  and specific.
- prefer editing the existing file that already owns the concern. do not create
  a second helper, store, query key, theme token or CSS convention beside an
  existing one. remove code made obsolete by a cutover instead of leaving an
  alias or shim.
- markdown-only work must not touch source, styles or tests. source work should
  keep `README.md` honest when it changes user-visible behavior.
- never commit `dist/`, `node_modules/`, coverage, logs or local env files.
  never run destructive git commands; leave unrelated worktree changes alone.

## known constraints and deliberate choices

- pinned feeds are identified by uri, not by display name. two feeds with the
  same name are both listed; names come from generator metadata through the
  canonical appview proxy and fall back to the rkey. do not “fix” this with name
  dedupe.
- feeds never refresh themselves. cached pages survive remounts and tab changes;
  only the explicit refresh paths reset them. this is why writes invalidate
  non-feed queries only.
- number keys are scoped, not global: `1`-`9` work only inside the active deck
  scroller or thread, and only when focus is not on a link, button or field.
- the settings transfer file excludes credentials by construction and by
  validation. never widen it to sessions, environment, drafts or relationship
  state.
- there is no server proxy. reads use the fixed `https://api.bsky.app` origin;
  a self-hosted pds used for sign-in must allow browser CORS.
- hosted portal login needs the deployed origin and public json metadata from
  the same build. `localhost` and any origin other than the baked one keep the
  password fallback.
- a thread is flattened to depth 3 and capped at 80 entries: root-first
  ancestors, then the focus post, then replies in pre-order.
- notifications are a single 50-item page. there is no paging, push or polling.
- profile mode decks only describe fetched author pages; the modes filter one
  author feed query and never fetch a separate mode feed.
- images are dithered by an inline SVG filter (`DitherImage`, `dither.ts`,
  `styles/dither.css`) while the dither-effects preference is on, never canvas,
  because the bluesky CDN does not expose pixel data cross-origin.
- video starts as a dithered poster button; activating it mounts the custom
  themed player. `hls.js` is imported dynamically only after that activation, so
  it stays in its own chunk; native HLS is used when the browser has it, and a
  player in its loading phase disables the overlay and seek control rather than
  reporting a failure. a failed load offers one explicit retry; unsupported
  playback says so and offers none. `m` opens a media viewer for images or
  video. quoted posts show their author, text, media and an open link, and `o`
  opens the quote's own thread.
- search is a tab between feeds and notifications and also a route: clicking
  the tab, `/` or `s` reach it. suggestions are accounts only; typed `#tag`
  searches as text.
- account labelers only contribute labels on cards and profiles; their full
  profiles are not rendered and no labeler-detail request exists.
