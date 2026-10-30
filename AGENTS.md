# agents

operating notes for changing benday. `README.md` describes the product for
readers; this file describes the implementation and the rules for editing it.
read the code first when the two disagree.

benday is a static react client for bluesky. there is no backend of this
project, no server-side proxy and no database. public reads go to the selected
appview; writes and account state go to the signed-in account's pds. everything
else is browser storage.

## layout and ownership

```text
src/
  main.tsx              react root and the stylesheet import order
  App.tsx               query client, routes, tab order, global dialogs, theme
                        application, global hotkeys
  lib/                  framework-free logic and zustand stores
  hooks/                react/query glue around lib
  components/           presentation and interaction
  components/ui/        dumb TUI primitives (Button, Dialog, Frame, Kbd, ...)
  views/                route views: FeedView, SearchView, ProfileView,
                        NotificationsView, ThreadView
  styles/               tokens first, then base, layout, components, cards,
                        dialogs, account, views, notifications, compose, dither,
                        theme-effects last
  test/                 fixtures and the vitest setup file
public/                 favicon
```

routes: `/` and `/feed` render `FeedView`, `/search` renders `SearchView`,
`/profile/:actor` renders `ProfileView`, `/thread?uri=…` renders `ThreadView`,
`/notifications` renders `NotificationsView`, and anything else is the not-found
view. `TAB_ROUTES` in `App.tsx` is `['/feed', '/notifications']`; search is a route and `s` shortcut, not a tab; a profile route
is appended only while it is open.

ownership by concern:

- `src/lib/atproto.ts` owns read requests and mapping through
  `src/lib/model.ts`. components and views do not build read agents; the appview
  probe in `src/hooks/useAppViewProbe.ts` is the one deliberate exception and
  builds a bare agent.
- `src/lib/auth.ts` owns the active agent, session persistence, pds resolution
  and sign-in/sign-out. `src/lib/oauth.ts` owns the loopback portal and
  indexedDB. do not create a second session path.
- `src/lib/actions.ts` owns writes: like, repost, reply, quote, post, delete and
  feed feedback. `src/lib/profileActions.ts` owns follow, mute, hide reposts,
  block and per-account activity subscriptions. `src/lib/actionStore.ts` owns
  optimistic like/repost state.
- `src/lib/queries.ts` owns invalidation policy; `src/hooks/useBskyQueries.ts`
  owns query keys and paging. changing cache behavior means changing both.
- `src/lib/notifications.ts` owns notification mapping and seen updates;
  `src/hooks/useNotifications.ts` owns the notifications query.
- `src/lib/markdown.ts` and `src/lib/facets.ts` own composer marker parsing and
  facet rendering. do not duplicate byte-offset math in a component.
- `src/components/CommandPalette.tsx` owns palette commands (navigation, themes,
  appviews, settings, help and account actions); `src/lib/command.ts` only parses
  `@handle`, `at://`, `#tag` and plain-text jumps.
- `src/lib/themes.ts` owns theme names, labels, schemes, seasons, groups, image
  effects and meta colours. `src/styles/tokens.css` owns per-theme values and
  `src/styles/theme-effects.css` owns shaped-corner and texture consequences.
- `src/lib/settingsTransfer.ts` owns the export/import file format and
  validation; `src/lib/store.ts` owns the persisted settings store.
- `Deck` owns focus, scroll position memory and deck-local keys. Views describe
  their cards; `Deck` moves between them.
- `src/test/fixtures.ts` and `src/test/setup.ts` support tests; shared view
  shapes belong in the fixtures file.

views are default exports; components are named exports. keep the `components/ui`
layer dumb and token-driven, and put theme-specific overrides in
`theme-effects.css` rather than scattering `[data-theme]` selectors.

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
and run pnpm directly.

```sh
pnpm dev        # vite on 0.0.0.0:5173, strict port
pnpm build      # tsc --noEmit then vite build into dist/
pnpm preview    # static preview on 0.0.0.0:4173, strict port
pnpm typecheck  # strict tsc pass
pnpm lint       # biome check .
pnpm format     # biome check --write .
pnpm test       # vitest run, 200 offline tests
pnpm check      # lint, tests, then build
```

open the dev server at `http://127.0.0.1:5173/` or `http://[::1]:5173/` for the
portal flow, or at `localhost` for the password form. vite and preview bind all
interfaces on purpose.

before handing off a change, run the narrowest check that covers it, then
`pnpm check` unless the task explicitly says not to run gates. tests are offline
and must not require a pds, appview or network.

## auth and privacy boundaries

- there is no first-party server. never add an endpoint that receives sessions,
  passwords, drafts or settings.
- browser storage keys are fixed: `benday:settings` (theme, appview, labelers),
  `benday:session` (password-session tokens), `benday:drafts` (composer drafts)
  and `benday:jump-history` (last five palette jumps). portal oauth state lives
  in the browser's indexedDB. do not rename or reuse these keys without a
  migration.
- the password is passed to the api once and never persisted. password sessions
  store the sdk session in localStorage; portal sessions are managed by
  `@atproto/oauth-client-browser`.
- portal login is available only on `127.0.0.1` and `[::1]` with the
  `atproto transition:generic` scope. a public deployment needs hosted oauth
  client metadata. `localhost` deliberately keeps the password fallback because
  the oauth client would rewrite it and orphan the localhost origin's stored
  session and settings.
- sign-out revokes the portal session, logs out the password agent, clears
  `benday:session` and resets per-post action state. a stale restore must not
  overwrite a newer sign-in; keep the `authEpoch` guard and the action-store
  subscription in `src/lib/actionStore.ts`.
- reads go to the selected appview with the configured labeler dids through the
  `accept-labelers` header. search terms and labeler dids are therefore visible
  to that appview. writes and viewer-state reads go through the account's pds.
  feed feedback and viewer-state reads use the canonical appview proxy, as does
  pinned generator metadata, so a custom appview does not receive the private
  pinned-feed uri list.
- `benday-settings.json` contains only `version`, `exportedAt`, `theme`,
  `appView` and `labelers`. it must never contain tokens, passwords, indexedDB
  state, drafts, jump history, profile relationships or any other auth material.
  unknown keys in an imported file are ignored; keep it that way.

## data flow

reads:

1. `createAgent(target)` builds an `AtpAgent` for the selected appview host and
   applies the labeler header.
2. `fetchFeedPage` chooses `getFeed`, `getAuthorFeed` or `searchPosts`; discover
   and custom feeds use the signed-in agent when one exists so JWT-gated
   generators can answer.
3. `mapFeedViewPost` / `mapPostView` / `mapProfile` / `flattenThread` in
   `src/lib/model.ts` produce the view models in `src/lib/types.ts`. components
   consume only those models.
4. search feeds attach missing reply parents in batches through
   `app.bsky.feed.getPosts`; thread reads use `getPostThread` with depth 3,
   parent height 6 and a flattened cap of 80 entries.

writes:

- `actions.ts` and `profileActions.ts` use `getAuthAgent()`. signed-out calls
  either throw or are gated in the component before they are attempted.
- writes that change records outside the feed (post, reply, quote and delete)
  call `invalidateNonFeedQueries(queryClient)`. that helper deliberately leaves
  every key whose first element is `feed` untouched. likes, reposts and profile
  relationship changes update their local stores or profile query instead.
- a composed post, reply or quote clears its draft and invalidates non-feed
  queries. it does not navigate to a thread that may not be indexed yet.

query keys and policy:

```text
['feed', host, 'discover', viewerDid | 'anonymous']
['feed', host, 'author', actor]
['feed', host, 'search', query]
['feed', host, 'feed', uri, viewerDid | 'anonymous']
['profile', host, actor]
['thread', host, uri]
['pinned-feeds', host, did]
['notifications', 'list', did | 'anonymous']
['top-comments', host, uri]
['feed-preview', host, source, viewerDid]
['labeler-details', host, key]
['actor-suggestions', host, query]
['tag-suggestions', host, query]
```

the feed infinite query uses `staleTime: Infinity`, `retry: false`,
`refetchOnMount: false`, `refetchOnReconnect: false` and
`refetchOnWindowFocus: false`. its `retry` is `resetQueries({ exact: true })`,
which drops pages and resets to the first page; further paging belongs to the
intersection sentinel. the query client defaults elsewhere are 45s stale time,
one retry and no window-focus refetch.

do not add implicit feed refreshes. switching tabs, restoring a cached deck,
changing a labeler and finishing a write all leave feed cards alone. the
explicit reloads are the refresh control on the feed mode card and the mobile
strip, `R R` in the feed view, the refresh card at the end of a profile deck, and
submitting the same search again. notifications are the one view that refetches
on mount and reconnect by design.

`ProfileCard` patches every `['profile']` query for the same did through
`setQueriesData`, so a relationship change applies regardless of which host
cached the profile.

## profile model, actions and modes

`ProfileView` (`src/views/ProfileView.tsx`) fetches one author feed with
`filter: 'posts_with_replies'`. `mapProfile` keeps pronouns, links, labels, bot
status and the full viewer state. `ProfileCard` renders the identity and owns the
actions; it never fetches a second profile shape.

- actions: follow/unfollow, mute/unmute, hide/show reposts, block/unblock and
  `notify posts` / `notify replies` (an activity subscription for that one
  account). mute, unmute, hide/show reposts, unblock and the subscriptions apply
  an optimistic viewer patch; follow/unfollow and block wait for the server
  result. any failure restores the previous viewer state and shows the error
  inline.
- `mutedOnlyReposts` is applied twice: the profile deck filters reposted entries
  out client-side, and the relationship tag says `reposts hidden`.
- external profile links are rendered only for `http:` and `https:` urls, open
  in a new tab and fall back to the hostname when the title is empty.
- modes are `posts`, `replies` and `media` (`ProfileModeCard.tsx`). they are
  client-side filters over the loaded author pages: standalone non-reply
  entries, replies authored by this account, and entries with image or video
  embeds. counts and empty states describe what has been fetched, not the whole
  account.
- on wide screens the mode deck is a real `Deck` reached by pressing left from
  the first post; mobile uses the pinned-style mode strip. escape closes the mode
  deck. the refresh card reloads the author feed.

## notifications

`NotificationsView` is signed-in only. `fetchNotifications` asks the pds for the
latest 50 notifications; `mapNotification` keeps reason, actor, subject, subject
text, read state and index time. `notificationReasonGroup` and
`notificationReasonLabel` map follow, like, like-via-repost, repost,
repost-via-repost, reply, mention and quote, label a few newer reasons, and fall
back to a generic label. `notificationSubjectHref` links a follow to the actor
profile and only post at-uris to `/thread?uri=…`.

opening the view marks the list seen once per did using the newest indexed time.
`markNotificationsSeen` is best effort and must never block or fail the list.
there is no paging and no realtime subscription; the refresh button and the
query's mount/reconnect refetch are the reload paths.

## inline reply and quote composition

`src/lib/ui.ts` holds the mutually exclusive UI state: `dialog`, `compose` (the
dialog request) and `inlineCompose` (the dock request). opening one closes the
other two.

`PostCard` opens an inline composer only when it is the focused card and is
rendering inside a thread (`focused && replies !== undefined`); elsewhere it
opens the dialog. `ThreadView` renders `InlineComposer` only when the request
targets the focused post. a quote dock sits above the post and a reply dock below
it. escape closes the dock and `ctrl`/`cmd` + `enter` submits.

both paths share `useComposeForm`: 300 graphemes counted on stripped text, the
markdown subset from `src/lib/markdown.ts`, `@` and `#` suggestions, per-target
drafts, the same `createPost` / `createReply` / `createQuote` helpers and the
same post-send invalidation. reply records carry
`reply: { root: post.replyRoot ?? parent, parent }`; quotes embed the target
record. the thread view also shows an `in reply to @handle` link above the focus
card when the appview supplied a parent.

draft keys are `${owner}:post` or `${owner}:${mode}:${targetUri}` with
`owner = accountDid ?? 'signed-out'`; at most 20 drafts are retained, oldest
evicted first. a successful send clears the draft; closing the composer writes
it.

## themes and seasonal availability

`src/lib/themes.ts` is the source of truth for the eighteen themes: display
order, lowercase labels, dark/light scheme, october-only season, image effect,
meta colour and the picker groups. `index.html` duplicates the colour table and
the october set in a pre-hydration script; update both together.

- appearance is `light`, `dark` or `system`; `lightTheme` and `darkTheme` hold
  independent selections. the store derives the active `theme`, `App.tsx`
  listens to `prefers-color-scheme` while in system mode, and the settings
  preview splits into both halves. `imageEffects` gates `DitherImage`.
- settings and keyboard help both have a `/`-focused search field; settings
  search hides nonmatching sections instead of rendering result buttons.
- deck focus rings are drawn on the card frame, not the list item, so they follow
  rounded themes; cyberpunk uses a drop-shadow around its clip path.
- signed-out cards hide the interaction bar entirely; the signed-out feed shows
  a welcome peek and left from the first post opens sign-in. feedback hides
  more/less after a successful more press.
- `resolveTheme(theme, date)` returns `void` when a persisted seasonal selection
  is unavailable. `availableThemeGroups(date)` hides the other seasonal themes
  outside october, and the settings dialog says when they return.
- `App.tsx` applies the resolved theme to `documentElement.dataset.theme`, updates
  the `theme-color` meta tag and persists the fallback back into the store.
- image effects default to `grunge`; the four benday themes use `grunge`,
  `catppuccin mocha`, `catppuccin latte`, `atom one dark`, `github dark` and
  `github light` use `clean`; `truth to materials` uses `industrial` and
  `bluesky` uses `none`. `DitherImage` honors the persisted `imageEffects`
  toggle by forcing `none`.
- `tokens.css` defines `--surface-texture`, `--theme-radius` and `--theme-clip`
  per theme. texture is per-theme: the root provides the scanline, cyberpunk
  adds a grid, the seasonal themes substitute their own weaves, and
  `truth to materials` and `bluesky` set none. cyberpunk uses an octagonal clip.
  `candy crypt` rounds 5px, `cottagecore` 4px, `bluesky` 3px, `pumpkin ember`
  and `dead leaves` 2px; the rest are square. `theme-effects.css` hides the
  square frame ticks on shaped themes and keeps clip paths off focusable
  controls.
- when adding a theme, update `Theme` in `src/lib/types.ts`, every record in
  `src/lib/themes.ts`, the `index.html` colour table (and seasonal set if
  needed), a `[data-theme="…"]` block in `tokens.css`, and the theme tests.

## settings transfer

`src/lib/settingsTransfer.ts` defines the version 1 file:
`{ version, exportedAt, theme, appearance, lightTheme, darkTheme, imageEffects, appView, labelers }`.
export is built from exactly those portable preferences, so extra properties
cannot leak. import validates the version, theme, appview and labeler array
before touching the store. `importSettings` applies the appearance fields, theme
and labelers in one `set`, so malformed input leaves settings untouched.

normalization rules to preserve:

- legacy theme `duotone` maps to `cyberpunk`; seasonal names are stored as-is
  and resolved at render time rather than rewritten in the file.
- an appview is rebuilt from its host, so a file cannot relabel one host as a
  different preset; an unknown https host becomes a custom target.
- labeler dids are trimmed, must start with `did:`, are deduplicated in order
  and capped at 20; junk entries are dropped.
- unknown top-level keys, including credential-shaped ones, are ignored on both
  build and parse.
- errors stay inline in the settings dialog; the file input is cleared after a
  pick so the same file can be retried.

## keyboard model

there are four key layers, and they must not fight:

1. `useHotkeys` (`src/hooks/useHotkeys.ts`) is installed by `AppShell` only when
   no dialog, compose dialog or inline composer is open. it ignores editable
   targets, repeats, handled events, and modifier combinations unless the
   binding asks for `ctrl`/`cmd`. bindings: `/` and `ctrl`/`cmd` + `k` palette,
   `s` search, `c` compose, `a` appviews, `?` help, `,` settings, escape back.
   settings and help each own a `/`-focused search field.
2. tab switching is a separate capture listener in `App.tsx` for
   `ctrl`/`cmd` + left/right. tabs are `/feed` and `/notifications`; a
   `/profile/…` route is appended as a temporary tab while it is open. search is
   a route reached by `s`, not a tab.
3. `Deck` listens on window and owns card movement. `1`-`9` are 1-based and act
   only when the deck scroller contains the active element and the target is not
   interactive. `g`/`G` and home/end jump. enter/space and the axis open key
   activate. wide decks move horizontally with arrows or `h`/`l`; narrow decks
   move vertically with arrows or `j`/`k`. page up/down and shift-arrows scroll
   the focused post body and only prevent default when the body actually moves.
4. view-local handlers add the rest: `PostCard` handles `0`, `f`, `b`, `r`,
   `q`, `+`, `-` and `d d` only while focused and unmodalled; `FeedView` owns
   `R R`; `ThreadView` owns reply focus and navigation. every layer ignores
   dialogs, open composers, editable targets, `event.defaultPrevented` and
   repeats.

`0` only acts when the focused post has a quoted post. `d d` only appears for
the signed-in account's own post records and arms on the first press. `R R`
arms on the first press and resets the feed on the second. `useInputMode` writes
`data-input="keyboard" | "pointer"` on the document element for CSS.

## tests and verification

the suite is vitest with jsdom, testing library, `css: true` and
`restoreMocks: true`. setup lives in `src/test/setup.ts`, shared shapes in
`src/test/fixtures.ts`. tests are co-located as `*.test.ts` / `*.test.tsx`.
there are 200 tests across 19 files; keep that number in `README.md` accurate
when tests change.

what the suite covers, and what it does not:

- covered offline: facets and byte offsets, post/embed/profile mapping, markdown
  limits, thread flattening, appviews and capabilities, time, dither generation,
  themes and seasons, pinned-feed preferences and selection, mention detection,
  command parsing, palette precedence, action auth gates and optimistic counts,
  focused-card shortcuts including quoted-post opening, the reply composer and
  drafts, the feed cache guard, the viewer-state proxy, feed feedback and
  settings import/export.
- not covered by unit tests: notifications rendering and mapping, the profile
  action buttons, the inline composer dock, real pds writes, the portal redirect,
  live appview switching and browser layout. those are checked manually against
  live hosts. do not claim a live check you did not perform.

when behavior changes, update the counts and the covered list in `README.md`'s
verification section, and add or adjust a focused test in the nearest existing
file rather than creating a parallel suite.

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
- there is no server proxy. custom appviews and self-hosted pds instances must
  allow browser CORS; a custom appview is public reads only.
- portal login is loopback-only in this static build; `localhost` and deployed
  origins keep the password fallback until hosted oauth metadata exists.
- a thread is flattened to depth 3 and capped at 80 entries: root-first
  ancestors, then the focus post, then replies in pre-order.
- notifications are a single 50-item page. there is no paging, push or polling.
- profile mode counts and decks only describe fetched author pages; the modes
  filter one author feed query and never fetch a separate mode feed.
- images are dithered by an inline SVG filter (`DitherImage`, `dither.ts`,
  `styles/dither.css`), never canvas, because the bluesky CDN does not expose
  pixel data cross-origin.
- video starts as a dithered poster button; activating it mounts the custom
  themed player. hls.js is used when MSE is available and native HLS is the
  fallback; `m` opens a media viewer for images or video. quoted posts show
  author text and an open link, not the quoted media.
- search is capability-gated per appview. public and blacksky disable it; a
  custom host attempts it. the `/search` route and the `s` shortcut remain even
  though search is not a tab.
- labeler services only contribute tags on cards and profiles; their full
  profiles are not rendered.
