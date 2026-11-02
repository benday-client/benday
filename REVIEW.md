# benday quality review

an end-to-end audit of the client at `b6885d5`, with the fixes that survived
execution, the evidence behind them and the limits that remain. history before
this audit is preserved; every commit below was verified as the exact staged
tree it carries.

## scope

covered: the type boundary, auth restoration and revocation, draft persistence
and composer ownership, opaque post records and facet projection, notification
and reply hydration, keyboard ownership, post-card continuations, router
transitions, palette jump history, suggestion shaping, shared view helpers,
action-store transitions, browser boundaries (settings import, native button
markup, top-comment pending), browser colour resolution, theme provenance and
oklch identity, preview isolation, the long-deck profile, dead code, and the
executable gate that carries the practices forward.

intentionally not changed: the product model (public AppView reads,
authenticated PDS writes, explicit-only feed refresh, viewer-scoped private
reads, per-account drafts, native dialogs, existing shortcuts, single 50-item
notification page), the loopback-only portal OAuth and its legacy SDK, the
custom-chevron media viewer, and the deliberate typography and geometry of each
theme. no dependency was upgraded; no remote or CI provider was invented.

## findings and fixes

grouped by the commit that carries them; `node scripts/check-staged.mjs` ran the
whole gate against each indexed tree before it landed.

### gate and types

- **the gate checked the worktree, not the commit.** `scripts/check-staged.mjs`
  exports the index into a throwaway repository, refuses unmerged and
  intent-to-add entries, installs from the frozen lockfile and runs `pnpm check`
  there; `.pre-commit-config.yaml` installs it through pre-commit's native node
  support. proof: `scripts/check-staged.test.mjs` builds real repositories whose
  `check` script imports a module, and proves an unstaged dependency fails while
  a staged or skip-worktree one passes.
- **double assertions laundered types.** `scripts/check-assertions.mjs` parses
  every tracked and untracked source file with `@babel/parser` and rejects an
  outer assertion whose inner assertion erased the type through `unknown`,
  `any` or `never`, including parenthesized, commented, multiline, angle and tsx
  forms; `suspicious.noExplicitAny` is now an error. the fake-agent fixtures in
  `actions.test.ts` and `profileActions.test.ts` were replaced with real
  `AtpAgent` instances driven over the recording transport, so the assertions
  now read the wire (request bodies, repeated query params, auth and proxy
  headers) instead of mocked SDK echoes. proof: the gate's own matrix plus both
  suites.
- **record parsing repeated unsafe bridges.** `src/lib/records.ts` is the one
  `isRecord` predicate; auth, oauth, appviews, drafts, settings transfer, store,
  notifications and the palette history narrow through it, keeping their real
  field checks. a parsed settings file is fed into `normalizePortableSettings`
  as `unknown` before any typed builder.

### auth and composition

- **a transient restore failure signed the reader out.** `restore` now commits
  the session the SDK retained after a 500, a thrown request or a non-expiry
  rejection, and clears stored auth only when the SDK itself dropped it (401 or
  an expired/invalid token). proof: `src/lib/auth.test.ts` routes each response
  shape and asserts the retained or cleared outcome.
- **a failed portal restore was invisible.** `restoreError` is ephemeral state
  rendered as an `ErrorNotice` above the route, cleared by opening login, an
  explicit sign-in, sign-out or `clearError`; a successful password fallback
  keeps it. `signInWithPortal` is now `Promise<void>` because the redirect never
  resolves into a session.
- **a superseded candidate left a live remote session.** a password candidate
  that loses the epoch after its own login is best-effort logged out before it
  returns false, without touching the committed account.
- **draft storage lied about durability.** `readDraft` returns
  `{ text, revision, available }`, `writeDraft` returns `{ ok, revision }` and
  `clearDraft` returns a boolean; an inaccessible store is never reported as an
  empty map. the composer keeps `saved` and `readSnapshot` snapshots, clears the
  exact pair on a successful send, warns while storage is unavailable, and after
  a post exists but its draft cannot be cleared keeps the composer with `sent`,
  read-only text, one send and no re-autosave on close. proof:
  `drafts.test.ts` plus the composer scenarios for a failed final flush, a
  failed opening claim, persistent denial and post-send cleanup failure.

### reads and records

- **lexicon `unknown` payloads were asserted whole.** `readPostRecord` projects
  the post type, text, facet payload and both reply refs from `unknown`, and
  `mapFacets` validates the array, integer byte ranges, feature lists and typed
  payloads; malformed content stays empty or loses only its own feature, and a
  valid neighbour survives. proof: unit cases plus `fetchFeedPage`/`fetchThread`
  transport fixtures with numeric text, index-less facets, half reply refs and
  numeric quoted text.
- **notification hydration asked `getPosts` for records it cannot answer.** only
  post subject uris are chunked, so a starter-pack notification keeps its row
  without spending a request. proof: the mixed fixture in
  `notifications.test.ts`.
- **hydration batches ran serially.** reply-parent, hidden-author and
  notification-subject reads now start their 25-item batches together with
  `Promise.allSettled`, merge in chunk order and keep every batch that answered.
  proof: barrier tests that deadlock a serial implementation, plus a failed
  sibling batch leaving its own context missing only.
- **one invalidation policy, one stable-root set.** `invalidateNonFeedQueries`
  skips exactly `feed`, `pinned-feeds`, `feed-generator` and `labeler-details`,
  and the test seeds real viewer-scoped keys, observes the invalidation flags and
  refetches only the invalidated queries.

### interaction ownership

- **card and thread shortcuts stole keys from unrelated controls.** the shared
  `isInteractiveTarget` plus a containment check now makes a card or thread yield
  to a control outside its own surface, while in-surface links and editors keep
  their existing exceptions. proof: jsdom ownership tests and the deck's existing
  outside-control test.
- **a stale card completion could repaint a different card.** `PostCard` owns a
  layout-lifecycle token keyed by post uri and account did; identity change or
  unmount invalidates it, clears the copy, feedback and delete-arm timers and
  resets the local surface before paint. clipboard, feedback and delete check the
  token after every await and in finally/timers, while a completed remote delete
  still invalidates its reads. `v` and its overlay hint exist only for a bare or
  quoted video with a non-null playlist. proof: replaced-card, after-unmount and
  null-playlist tests, including the held `?` overlay.
- **a superseded view transition could commit an old route.** every navigation —
  animated, direct or an unmount — advances the sequence and skips the queued
  transition; the update callback checks its captured sequence and the finished
  promise releases the slot on fulfillment or rejection. proof: a queued update
  released after a newer direct navigation, and after unmount, cannot move the
  route.
- **stored palette jumps could leave the document.** history entries are parsed
  as unknown records, resolved against the current origin and protocol, and
  stored back as path+query+hash; protocol-relative, backslash-authority,
  `blob:` and malformed entries are ignored.
- **suggestion stepping used a stale index.** `buildSuggestions` is the single
  shaping rule (fetched actors/tags, nonempty literal fallback, never an empty
  marker) for composer, search and palette, and arrow steps start from the
  clamped visible row, so a settled list that shrinks wraps from what the reader
  sees. proof: shaping unit tests, the composer shrink scenario and the palette
  literal-handle path.

### deck interaction

- **every move re-rendered all loaded cards.** `PostCard` is memoized and its
  view callbacks take the captured post or uri, with the view owners memoizing
  them, so a move re-renders only the two cards whose focus changed. measured on
  unchanged fixtures: 1,500-card p95 fell from 141–222 ms to 30–43 ms, every
  size and viewport now stays under 100 ms and within ~1.35× of the 32 ms
  baseline, and isolated appends stay under the 200 ms main-thread threshold
  (details below). browser-native containment was measured and removed because
  it added nothing; windowing was not triggered.

### shared helpers and boundaries

- `useRetainedError` owns first-load retry retention for search, feed, profile and
  thread (same signature, state rather than refs, identity change or success
  clears, repeat press ignored); `useDealFlash` owns the 900 ms deal lifetime;
  `ComposeTarget` owns the target line both composers render;
  `resolveHandleDid` owns handle-to-did for both sign-in paths; `toggleSide` owns
  the shared like/repost read-lock-rebase policy with side-specific fields.
- settings import refuses a file above 256 KiB before calling `text()`, keeps the
  dialog usable and leaves settings untouched; exactly 256 KiB proceeds.
- `ModeCard` keeps a native button with phrasing-only descendants, so its one
  accessible name and description survive the parser.
- `useTopComments` derives one `active` condition, so an enabled card with no
  usable uri is not pending, sends nothing and exposes no cached row.
- the browser suite imports `src/appStyles.ts`, the same cascade as `main.tsx`,
  and `src/test/colors.ts` resolves every browser-supported colour (oklch, alpha,
  `color(srgb …)`) to painted 8-bit sRGB instead of comparing serialization
  strings. `installCursors` resolves each token in the real theme context and
  serializes a concrete SVG colour, converting non-SVG serializations through at
  most one canvas per installation; a jsdom run without canvas keeps the
  fallbacks.

### themes

- **GitHub, Bluesky and Atom roles were stale or overclaimed.** GitHub's roles
  follow pinned `@primer/primitives` 11.10.0 (blue-deep is an explicit
  derivative); Bluesky follows `@bsky.app/alf` 0.2.1's light palette; One Dark's
  `--ink` is documented as the existing brighter UI adaptation of upstream
  `#abb2bf`; Catppuccin (palette 1.8.0) and Dracula classic keep their canonical
  swatches. the chrome colour is the painted `--void`, so cyberpunk's metadata
  is now real black and Bluesky's matches its page; the copied colour table test
  was replaced by a browser check that `themeColor` is supported and paints the
  page.
- **the benday originals now express literal colours in oklch** with whole 8-bit
  paint equivalence (173 unique conversions checked in Chromium; one boundary
  value needed a 5-decimal nudge), exactly neutral sources use `C = 0` with
  `hue none`, and each family keeps its measured role order (cottagecore's panel
  below its paper, cyberpunk's page and paper the same black, truth to materials
  wider achromatic steps, intentional accent hues except the monochrome material
  family).
- **preview isolation depended on a duplicated reset.** the shared effect and
  signature defaults now live in one `:root, [data-theme]` rule before the theme
  blocks; a preview nested in any other theme computes the same signature,
  texture and colours as a standalone one. high contrast derives
  `--line: light-dark(#3a3a3a, #c8c8c8)` so the frame and outline boundaries
  clear 3:1 on both adjacent surfaces in both schemes while text keeps its ≥7:1
  policy. confirmed duplicates were removed and the card-back index keeps its
  winning ink colour in the owning view rule.

### dead weight

verified references first, then removed `DEFAULT_IMAGE_EFFECT`, `mentionAt`,
`bayerThreshold`, `BAYER_VALUES`, `formatClock`, the unreachable copies of their
tests, the exact display-label assertions, and ten unused prop-type re-exports;
`profileWebUrl` and `CardBackOpenAction` became module-private (both have internal
consumers). the Bayer matrix and SVG tile path, and the absolute/relative time
APIs, are unchanged. ProfileCard's imports moved above its first interface.

## retained limitations

- notification unread markers still describe the AppView snapshot; hidden rows
  advance the cursor but no local read model is invented.
- cached labeler data stays alongside a genuine refresh error; a manual refetch
  keeps its null guards; the default TanStack cache-fill behaviour is unchanged.
- optional identity display still falls back to the did; partial parent,
  moderation and notification hydration stays best effort and reports what it
  could not fill.
- jump history remains an optional enhancement: a storage failure is harmless and
  cross-tab writes are last-writer-wins.
- blocked draft storage is reported, never pretended durable; there is no
  cross-tab compare-and-swap or merge.
- portal sign-in is loopback-only and the password path keeps its legacy SDK
  session manager; no auth or deployed OAuth migration was attempted.
- `pnpm check` runs from a local hook that can be bypassed; there is no remote
  enforcement, no CI provider and no branch protection in this repository.
- no language server is configured; exported-symbol consumers were found with
  exact symbol/import searches, not LSP references.
- the long-deck numbers below are this machine's Chromium measurements, not a
  device SLA.

## long decks

method: production build served on loopback, deterministic typed feed fixtures
intercepted at the XRPC boundary, 30 / 600 / 1,500 loaded posts, at 1280×800 and
390×844, with normal and reduced motion, three runs per configuration in the same
Chromium on this machine. a run records mounted cards and DOM node counts, the
p50/p95 latency from a key press to the next painted selected card over 30 moves
after 5 warmups, and one page append measured on its own: the deck is first
parked 1.5 viewports before the sentinel and allowed to settle, then a
`PerformanceObserver` long-task window covers the nudge into view and the new
page's paint. the first harness version scrolled from the start of the deck to
the end in the same task and counted across both the switcher and content decks;
those numbers were discarded rather than reported. these are audit decision
thresholds, not a device SLA.

decision thresholds: a material interaction regression is a long-deck p95 above
100 ms and more than twice the 30-card baseline in at least two runs; an
interrupted page append qualifies when it blocks the main thread above 200 ms
with the same comparison. the pre-fix run crossed the interaction threshold at
1,500 cards (wide p95 141.6–180.0 ms normal and 210.1–222.4 ms reduced; narrow
152.7–163.7 normal and 178.4–190.8 reduced against a ~32 ms baseline), because
every selection change re-rendered all 1,500 cards through an inline
`renderItem`.

changes retained (both measured on unchanged fixtures):

- `PostCard` is memoized, and its view callbacks take the captured post or uri
  (`onOpen(post)`, `onDismiss(uri)`, `onFeedback(post, event)`) with the view
  owners memoizing them. a move now re-renders only the two cards whose focus
  changed. after this, every long-deck p95 is between 29.6 and 43.0 ms (worst
  run 43.0, reduced-motion 1,500 wide) — below 100 ms and at most ~1.35× the
  32 ms baseline; no interaction threshold is crossed at any size, viewport or
  motion setting.
- browser-native `content-visibility` containment on horizontal card bodies was
  tried and then removed: with it disabled the identical 1,500-card fixtures
  measured the same or better (p95 32.1–57.3 ms, zero long tasks), so it was not
  retained as an unmeasured change.

append after the fix (isolated): max main-thread task 0 ms at 30 and 600 cards;
at 1,500 cards 0–81 ms wide (one 50 ms outlier), 106–110 ms narrow, and 78–79 ms
narrow reduced — all below the 200 ms block threshold, so the windowing step was
not triggered. one wide normal-motion append run did not observe a new page
within the 20 s window (the sentinel did not answer); the other two runs at that
configuration answered at 331 ms and 266 ms with long tasks of 81 ms and 71 ms,
so the threshold still has two answered runs. append wall time at 1,500 cards is
still 254–408 ms because it includes the new cards' full mount; only its
main-thread block is bounded by this change.

remaining structural limitation: the deck still mounts every loaded card and
keeps its full DOM. measured mounts were 30 cards / 581 deck nodes / 1,556
document nodes, 600 cards / 11,411 deck nodes / 12,386 document nodes, and 1,500
cards / 28,501 deck nodes / 29,476 document nodes (identical with and without the
removed containment rule).
history is never dropped and no page cap was introduced, but memory grows with
the loaded history; a windowed body with pinned interaction states was not
needed to clear the measured thresholds and is not claimed.

## verification ledger

| commit                                                                     | behavior verified                                                           | command / scenario and outcome                                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `test: page the palette from the clamped row`                              | palette page keys move from the clamped row                                 | `pnpm test:browser src/components/CommandPalette.browser.test.tsx` — 18 passed                                                         |
| `chore(quality): verify the staged snapshot before commits`                | index snapshot gate, intent-to-add refusal, original index untouched        | `pnpm test:quality` — 16 passed (runner + assertion gate suites); hook ran the full gate                                               |
| `refactor(types): replace assertion bridges with typed boundaries`         | real SDK transport in action tests, records predicate, assertion ban        | `pnpm test` 850 at that commit; `pnpm check:assertions` clean; staged gate passed                                                      |
| `fix(auth): retain sdk-preserved sessions after refresh failure`           | transient/network/non-expiry retention, 401 clearing, stale restore         | `pnpm test src/lib/auth.test.ts` — 19 passed                                                                                           |
| `fix(auth): show portal restore errors outside the login dialog`           | restore notice above the route, clears on login, password fallback keeps it | `pnpm test src/lib/auth.test.ts src/App.test.tsx` — 38 passed                                                                          |
| `fix(auth): revoke superseded uncommitted sign-ins`                        | lost candidate sends deleteSession, replacement does not                    | `pnpm test src/lib/auth.test.ts` — 23 passed                                                                                           |
| `fix(compose): preserve draft ownership across storage failures`           | failed flush/claim cleanup, sent state, inaccessible storage                | `pnpm test src/lib/drafts.test.ts src/hooks src/components/ComposeDialog.test.tsx src/components/InlineComposer.test.tsx` — 103 passed |
| `fix(model): project unknown post records safely`                          | malformed record/facet/reply/quote content through real transports          | `pnpm test src/lib/model.test.ts src/lib/atproto.test.ts` — 65 passed                                                                  |
| `fix(notifications): hydrate only post subjects`                           | starter-pack subject not requested, like context kept                       | `pnpm test src/lib/notifications.test.ts` — 31 passed                                                                                  |
| `perf(reads): run independent hydration batches concurrently`              | batch barriers, failed sibling, stable invalidation roots                   | `pnpm test src/lib/atproto.test.ts src/lib/notifications.test.ts src/lib/queries.test.ts`                                              |
| `fix(keyboard): preserve focused controls outside cards and threads`       | outside control keeps keys, in-card control keeps activation                | `pnpm test src/components/PostCard.test.tsx src/views/ThreadView.test.tsx` — 102 passed                                                |
| `fix(post-card): discard stale local interaction completions`              | replaced/unmounted clip, feedback and delete; null-playlist `v`/`?`         | `pnpm test src/components/PostCard.test.tsx` — 63 passed                                                                               |
| `fix(router): invalidate transitions before every navigation`              | queued update cannot commit after direct nav or unmount                     | `pnpm test src/App.test.tsx` — 18 passed                                                                                               |
| `fix(palette): normalize stored jump destinations`                         | external/protocol-relative/backslash/blob entries ignored                   | `pnpm test src/components/CommandPalette.test.tsx` — 20 passed                                                                         |
| `refactor(suggestions): share shaping and step from the visible selection` | shrink stepping, literal fallbacks                                          | `pnpm test src/hooks/useActorSuggestions.test.ts src/components/ComposeDialog.test.tsx src/components/CommandPalette.test.tsx`         |
| `refactor(read-errors): share first-load retry retention`                  | retry keeps the control, identity change clears                             | `pnpm test src/hooks/useRetainedError.test.tsx` — 4 passed + view suites                                                               |
| `refactor(decks): share the deal flash lifetime`                           | restart and unmount cleanup                                                 | `pnpm test src/hooks/useDealFlash.test.tsx` — 2 passed + view suites                                                                   |
| `refactor(compose): share target context markup`                           | both composers render one target line                                       | `pnpm test src/components/ComposeDialog.test.tsx src/components/InlineComposer.test.tsx` — 47 passed                                   |
| `refactor(identity): share handle resolution`                              | did pass-through, trim/@, failure paths                                     | `pnpm test src/lib/identity.test.ts src/lib/auth.test.ts src/lib/oauth.test.ts` — 30 passed                                            |
| `refactor(actions): share like and repost state transitions`               | both sides lock, rebase, reject and recover                                 | `pnpm test src/lib/actionStore.test.ts` — 14 passed                                                                                    |
| `fix(settings): bound imported settings before reading`                    | oversized refused unread, 256 KiB accepted, settings untouched              | `pnpm test src/components/SettingsDialog.test.tsx` — 32 passed with the other boundary suites                                          |
| `fix(cards): keep mode button descendants phrasing-only`                   | one button, phrasing descendants, name/description/pressed                  | `pnpm test src/components/ui/ModeCard.test.tsx`                                                                                        |
| `fix(comments): stop pending state without a usable uri`                   | empty uri sends nothing and is not pending                                  | `pnpm test src/hooks/useReadState.test.tsx`                                                                                            |
| `refactor(themes): resolve painted colors across browser consumers`        | painted colour resolution, concrete cursor SVG, oklch cursor                | `pnpm test:browser src/App.browser.test.tsx` — 8 passed; theme suites 101 passed                                                       |
| `fix(themes): align sourced palettes and browser chrome`                   | chrome matches painted `--void`, high-contrast chrome                       | `pnpm test:browser src/lib/themes.browser.test.ts` — 19 passed                                                                         |
| `refactor(themes): express benday originals in identity-preserving oklch`  | 173 conversions paint identical 8-bit pixels, ordering and hue invariants   | throwaway Chromium equivalence test; `src/lib/themes.browser.test.ts` 23 passed                                                        |
| `fix(themes): isolate previews and honor high contrast borders`            | nested preview signature, 3:1 boundaries, contrast suite                    | `pnpm test:browser` — 206 passed                                                                                                       |
| `refactor: remove unused helpers and unnecessary exports`                  | reference audit, suites still green                                         | `pnpm test` — 903 passed                                                                                                               |

### production smoke

the final build was served on loopback and driven in Chromium at 1280×800 with
intercepted XRPC fixtures and an isolated storage context. narrow (390×844)
coverage comes from the browser suite and the long-deck measurements, not from
this smoke run. observed directly: the feed paints
the fixture cards; `v` activates a playable video and the held `?` overlay
teaches that key; an unrelated focused settings control keeps ArrowRight for
itself while the selected card stays put; a stored history jump lands on the
thread path with its fragment; an oversized settings file is refused with the
dialog still open; a profile mode card activated with Enter deals the posts
deck; the cursor data URI contains only concrete `rgba(...)` colours; the
high-contrast frame edge paints at 12.55:1 against the black page; and a search
click superseded by the brand link stays on `/feed`. a second run signed in
through the password form against a test PDS, confirmed the blocked-storage
warning, then sent one post while storage stayed blocked: cleanup failure left
`post sent · stored draft could not be cleared`, the primary action disabled and
labelled `sent`, the textarea read-only, and ctrl/cmd+enter produced exactly one
`createRecord`. not exercised in the production smoke: a portal restore failure
(needs a portal failure the static build cannot be made to produce; jsdom covers
the notice), the null-playlist video key (a validated wire video view always
carries a playlist, so that path is model/component tested rather than
wire-reachable), a pointer activation of a mode card (the smoke used Enter;
`ModeCard.test.tsx` covers the click), the light high-contrast scheme (the smoke
measured the dark page; `ThemeContrast.browser.test.tsx` checks both schemes),
nested preview geometry and the 390×844 layout (covered by the browser suite).

final gate: `pnpm check` — biome clean, `pnpm check:assertions` clean,
`pnpm test:quality` 16 passed, `pnpm test` 903 passed, `pnpm test:browser` 206
passed, production build succeeded.

## browser client comparison

method: Bluesky's web client was read from `social-app` `main` at the visible
release v1.137.0 (2026-10-29) — routes, appearance settings, composer, session
state, releases, issue #4081 and the four announcements below. Witchsky was read
at revision `d2eb5b8` (2026-11-01) — canonical README, routes, Navigation, web
composer, appearance settings, userstyles doc and activity feed. everything in
the peer columns is **source-declared**; no signed-in browser session was run
against either client, so deployment is not claimed. `not evidenced in the
reviewed source` means exactly that and is not a proof of absence or
impossibility. Benday's column describes this repository as executed above.

| capability                                                                                | benday                                                                                                    | bluesky browser                                                                                                                      | witchsky browser                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| centered keyboard card deck with half peeks and narrow two-up reading                     | implemented stock interaction                                                                             | no equivalent stock deck evidenced in the reviewed source                                                                            | no equivalent stock deck evidenced in the reviewed source                                                                                                                                  |
| ordered SVG dither/duotone plus 18 curated identities and four October seasonal palettes  | implemented                                                                                               | no equivalent stock treatment evidenced; appearance exposes only colour mode, dark theme and font                                    | custom themes/theme editor, hue slider and `.wsky-*` user CSS exist; equivalent stock dither/duotone or the 18/4 package not evidenced                                                     |
| feeds/search/thread/profile/notifications and text reply/quote composition                | implemented                                                                                               | implemented (routes, composer `quote`/`replyTo`)                                                                                     | implemented/source-declared (routes, Navigation bindings, composer)                                                                                                                        |
| dark/light appearance and keyboard navigation                                             | implemented                                                                                               | dark/light implemented; app-wide keyboard navigation not evidenced (lightbox keyboard a11y noted in v1.116)                          | dark/light themes implemented; browser keyboard navigation not evidenced                                                                                                                   |
| drafts                                                                                    | per-account local post/reply/quote drafts with revision ownership                                         | shipped feature; web-specific caching not separately verified; issue #4081 closed                                                    | web draft preservation, per-tab composer cache and account-switch preservation source-declared (2026-10-31 commits)                                                                        |
| image/video upload and alt-text editing                                                   | absent; rendering is not upload                                                                           | implemented (composer gallery/video and alt-text dialogs)                                                                            | implemented/source-declared                                                                                                                                                                |
| multi-post thread composer / profile and profile-link editing                             | absent                                                                                                    | thread composer and profile links implemented (announced 2026-10-22)                                                                 | multi-post web composer confirmed in `Composer.tsx`; profile-edit/profile-link details not independently checked                                                                           |
| direct messages / bookmarks                                                               | absent                                                                                                    | routes and shipped messaging evidence                                                                                                | confirmed routes plus Navigation screen bindings; README also describes chat improvements                                                                                                  |
| lists/starter-pack management and people lists for follows/likes/reposts/quotes           | no management surfaces; starter-pack notification is not management                                       | route-level evidence                                                                                                                 | confirmed route/screen bindings including StarterPackWizard, Lists, followers/follows and interaction people lists                                                                         |
| advanced moderation/reporting/muted-word-list management/reply permissions                | partial display plus follow/mute/block/repost-hiding/activity controls; management/report composer absent | broader implementation; moderation inbox is beta; muted-word management and a full report composer not located in the reviewed files | moderation/list/reply-permission routes and composer `ThreadgateBtn` confirmed; muted-word management and full report composer not located; do not infer deployment of every gated setting |
| authentication/account switching                                                          | app passwords; loopback-only portal OAuth; one active account                                             | multi-account session state and account routes evidenced; OAuth mechanism not located in the reviewed files                          | OAuth (`/auth/web/callback`), multi-account switching and per-account actions source-declared                                                                                              |
| translation / cloud settings sync                                                         | absent                                                                                                    | not evidenced in the reviewed source                                                                                                 | translation providers and settings sync source-declared                                                                                                                                    |
| custom AppView                                                                            | configurable public-read host                                                                             | no user-selectable stock control evidenced                                                                                           | custom AppView DID source-declared                                                                                                                                                         |
| metric-visibility controls / video download / PDS explorers, badges and CDN/PLC overrides | not implemented                                                                                           | each not evidenced in the reviewed source                                                                                            | all source-declared; Streamplace embeds also source-declared                                                                                                                               |
| push / mobile appearance                                                                  | no push; responsive browser client                                                                        | per-category push controls documented; browser push versus mobile push not separated in the reviewed source                          | README declares no push; Android Material You is mobile-only; app-store distribution is roadmap, not shipped support                                                                       |

primary sources: Bluesky
[routes](https://raw.githubusercontent.com/bluesky-social/social-app/main/src/routes.ts),
[appearance](https://raw.githubusercontent.com/bluesky-social/social-app/main/src/screens/Settings/AppearanceSettings.tsx),
[composer](https://raw.githubusercontent.com/bluesky-social/social-app/main/src/view/com/composer/Composer.tsx),
[session state](https://raw.githubusercontent.com/bluesky-social/social-app/main/src/state/session/index.tsx),
[release feed](https://github.com/bluesky-social/social-app/releases),
[drafts issue](https://github.com/bluesky-social/social-app/issues/4081),
[profile links](https://bsky.social/about/blog/10-22-2026-introducing-profile-links),
[moderation inbox beta](https://bsky.social/about/blog/10-30-2026-moderation-inbox),
[direct messages](https://bsky.social/about/blog/05-22-2024-direct-messages),
[notification controls](https://bsky.social/about/blog/07-02-2025-more-notification-control).
Witchsky
[README](https://tangled.org/jollywhoppers.com/witchsky.app/raw/main/README.md),
[routes](https://tangled.org/jollywhoppers.com/witchsky.app/raw/main/src/routes.ts),
[Navigation](https://tangled.org/jollywhoppers.com/witchsky.app/raw/main/src/Navigation.tsx),
[composer](https://tangled.org/jollywhoppers.com/witchsky.app/raw/main/src/view/com/composer/Composer.tsx),
[appearance](https://tangled.org/jollywhoppers.com/witchsky.app/raw/main/src/screens/Settings/AppearanceSettings.tsx),
[userstyles](https://tangled.org/jollywhoppers.com/witchsky.app/raw/main/docs/userstyles.md),
[activity](https://tangled.org/jollywhoppers.com/witchsky.app/feed.atom).
the stock deck, dither and curated seasonal package are distinctive within these
reviewed stock clients, not an impossibility claim about extensions, user CSS or
other clients. custom AppViews, drafts and basic theming are not Benday-exclusive.
