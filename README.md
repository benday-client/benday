# benday

a dithered tensorpunk client for the bluesky network

benday is a web client built around cards instead of a timeline. each post is a
square-edged index card with an ordered-dither portrait or image. on a wide
screen the focused card sits in the centre with half-neighbour peeks on either
side; narrow screens use a two-up vertical card list. appviews are switchable. the interface
is a small TUI: monospace body and chrome, one-pixel borders, lowercase labels,
keyboard-first, square corners by default. names and card titles set in a second
proportional face so they read apart from the monospace text.

reading is public and needs no account. signing in adds likes, reposts, quotes,
replies, a composer, own-post deletion, notifications, follow/mute/block
controls and the account's pinned feeds. the client talks to the pds that owns
the account and uses the selected appview for public reads.

no account data is stored on a server owned by this project. ui settings live in
localStorage under `benday:settings` (appearance mode, per-section themes, image effects, the high-contrast option, the selected appview and labelers).
settings can be exported to and imported from `benday-settings.json`; that file
holds only portable preferences and never sessions or credentials.
composer drafts live under `benday:drafts` scoped by account did.
password session tokens live under `benday:session`; portal sessions live in the
browser's indexedDB. the password is never stored. search terms are sent to the
selected appview when you search.

## appviews

| preset    | host                     | role                         | search                               |
| --------- | ------------------------ | ---------------------------- | ------------------------------------ |
| canonical | `api.bsky.app`           | official appview, direct     | yes                                  |
| public    | `public.api.bsky.app`    | official cached public reads | no, the cache does not expose search |
| blacksky  | `api.blacksky.community` | community appview            | no, upstream search is unavailable   |
| custom    | any https origin         | public reads only            | attempted                            |

canonical is the default because it supports search and custom feeds. the public
cache is still useful for cached reads. blacksky demonstrates a real independent
appview. a custom host must allow browser CORS. there is no server-side proxy.

reads stay on the selected appview. writes and viewer state go through the
signed-in account's pds. discover and custom feed requests use the signed-in
agent when one exists so feeds that require a JWT can return the account's
version.

## auth

the sign-in dialog offers the bluesky portal only on the `127.0.0.1` and `[::1]`
loopback origins. it uses the atproto loopback oauth client with
`atproto transition:generic`, so the browser is sent to the pds authorization
page and the password stays with the pds. open the dev server at
`http://127.0.0.1:5173/` or `http://[::1]:5173/` for this flow; a `localhost`
origin keeps the password form, because the oauth client would rewrite it to
the loopback IP and orphan the localhost origin's stored session and settings.
a public deployment needs hosted oauth client metadata before the portal can
work there.

the password and app-password form remains as a fallback. this is usually an
app password; some pds implementations do not expose app passwords and require
the account password instead. password session tokens live in localStorage;
portal sessions live in indexedDB. the password is never stored. sign out clears
the session and viewer state. a successful post closes the composer and
invalidates the loaded non-feed queries without opening a thread that may not be
indexed yet.

portal login is loopback-only (`127.0.0.1` and `[::1]`) in this static build.
the password fallback works everywhere else, including `localhost`.

## keys and gestures

| key                     | action                                                          |
| ----------------------- | --------------------------------------------------------------- |
| `←` `→`                 | previous / next card on a wide deck; `→` opens on a narrow deck |
| `↑` `↓`                 | previous / next card on a narrow deck; `↓` opens on a wide deck |
| `j` `k`                 | previous / next card, on any deck                               |
| `h` `l`                 | previous / next card on a wide deck                             |
| back at the first card  | `←` on a wide deck, `↑` on a narrow deck                        |
| back at the first post  | the same back key exits the posts deck for the feeds deck       |
| back at the first feed  | the same back key exits the feeds deck back to the posts deck   |
| `home` / `end`          | first / last card, or first / last reply                        |
| `g` / `G`               | first / last card, the vim aliases                              |
| `1`-`9`                 | focus the nth card in the active deck, or the nth reply         |
| `enter`                 | open the focused card or reply                                  |
| `pgup` / `pgdn`         | scroll the focused post                                         |
| `shift` + `↑` `↓`       | scroll the focused post; always owned by the deck               |
| `esc`                   | the escape stack below                                          |
| `m`                     | open the focused post's media                                   |
| `v`                     | play or pause the focused video                                 |
| `x`                     | reveal labelled media before `m` or `v`                         |
| `o` (or `0`)            | open the focused post's quoted post                             |
| `y`                     | copy a bsky.app link to the focused post                        |
| `R`                     | refresh the feed once; ignored while a refresh runs             |
| `f` / `b`               | like / repost the focused card                                  |
| `r` / `q`               | reply / quote the focused card                                  |
| `+` / `-`               | more / less like the focused feed card                          |
| `d` then `enter` or `d` | delete your focused post; `esc` cancels, 4s disarm              |
| `ctrl`/`cmd` + `k`      | command palette, the same chord closes it                       |
| `/` (or `s`)            | go to search and focus the query field                          |
| `c`                     | compose a post                                                  |
| `a`                     | switch appview                                                  |
| `,`                     | settings                                                        |
| `?`                     | tap for keyboard help, hold for key badges                      |
| `ctrl`/`cmd` + `←` `→`  | switch feeds / notifications tabs, plus a temporary profile tab |

escape stops at the first layer it can close: an open dialog, then the composer's
suggestion list, then the inline composer, then a mode switcher, then a search
field with text (clear it, then blur), then back out of a thread or profile or
return to the previous tab. a feed deck has nowhere above it, so escape never
leaves it.

the top bar keeps the tab names: `feeds`, `notifications` and `@handle` for the
open profile. the active one carries a `//` marker. every action on the right
prints its word — `jump`, `search`, `appview`, `help`, `settings` — and the
chords stay off the bar until you hold `?`; on a phone the row wraps instead of
dropping the words. the compose entry only appears once you are signed in. holding `?` paints key badges
over the top bar actions and the focused card's actions, and releasing it
removes them; a tap still opens the keyboard help. the card footer has `re` replies, `like`, `rt` repost, `r` reply, `q` quote,
`copy link` and `m` media. clicking a top comment row or a quoted post opens its
thread; their author and open links still navigate independently. signed-out
cards keep `copy link` and hide the account actions. on your own posts a
two-step `delete` action appears beside them. `0` acts only when the focused card quotes another post,
`y` copies its bsky.app permalink, and `1`-`9` are 1-based positions that act
only while the deck or thread owns focus. the top bar has a compose button for signed-in
accounts, shows their handle, and offers keyboard help. signed out it offers a
log in button. the command palette accepts `@handle`, post and feed `at://`
uris, `#tags` and plain search text (enter searches when no command matches),
lists pinned feeds and recent jumps, and filters to theme and appview commands
by name (`theme bone`, `appview public`). with an empty prompt it lists compose
or sign in, feeds, search, settings, appview settings and keyboard help. it
keeps the last five jumps for a quick return. `@me` opens your own profile. a profile opened from a card gets
a temporary tab after notifications and loses it when you leave. search is a
route (`/search`) reached with `s`, not a permanent tab.

## themes

eighteen themes share the same dither pipeline: `void`, `bone`, `oxide`,
`phosphor`, `catppuccin mocha`, `catppuccin latte`, `dracula`, `atom one dark`,
`github dark`, `github light`, `cyberpunk 2077`, `cottagecore`,
`truth to materials` and `bluesky`, plus the october-only `pumpkin ember`,
`toxic midnight`, `candy crypt` and `dead leaves`. the four october palettes are
marked halloween in the picker and come back each october. themes are chosen in settings,
grouped under dark and light. the seasonal four appear only in october; a
persisted halloween selection falls back to `void` outside the month. a live
preview above the groups shows the current card image type tags controls input
and keycap with the theme's own surface texture and corners; while system
appearance is active it splits in two, and each half carries only its own
theme's corners, texture and hud. each theme also signs the reading card itself: a hatch and a rule on the author
band, a top rule or a lift on the frame, a corner bracket or an inset, the
cottagecore stitch, and the october sets add their own weave on top of their
corner glyph. `dracula` and both `catppuccin` palettes follow their upstream
implementations (purple and pink for dracula, blue and mauve for catppuccin).
`cottagecore` is a pressed-flower herbarium plate with linen surfaces, olive
ink, a stitched label head and images screened as one-ink halftone on cream.
cyberpunk cuts every boxed surface with the same octagon and keeps its brackets
on the corners it does not cut. most themes carry
a surface texture; `truth to materials` and `bluesky` drop it, while
`toxic midnight` and `candy crypt` use crossing diagonals and `dead leaves`
shifts the frame head. cyberpunk opts into magenta and cyan neon shadows, cuts the
top left and bottom right corners at 45 degrees, brackets the other two and
boots its windows with a scan print and a flicker; `candy crypt` rounds by 5px, `cottagecore` 4px, `bluesky`
3px and `pumpkin ember` and `dead leaves` 2px. the other themes keep square
corners and leave the neon tokens transparent.
single images scale to fit the viewport while keeping their natural ratio. media is dithered
through an inline svg filter with one duotone table per theme, not canvas. the ordered dither is an 8x8 Bayer matrix with 64 levels in a 16x16
tile. newer themes use their secondary palette colours for active navigation,
likes, comments and repost marks, and the accent-4/5 pair deepens comments,
quotes, tags and action hovers. image effects are themed too, defaulting to
`grunge`; `catppuccin mocha`, `catppuccin latte`, `atom one dark`, `github dark`
and `github light` use the clean ordered option, `truth to materials` uses an
industrial steel dither, and `bluesky` uses `none`. the appearance toggle turns
image effects off entirely for the current theme.


## labelers

the settings window can switch off single-key shortcuts (`keyboard shortcuts`,
on by default): letters like `f`, `j` and `x` stop firing while arrows, enter,
escape, page keys and every modifier chord keep working. the palette chord and
`/` stay reachable either way.

a window opens with focus on its first field, or on the window itself when it
has none, never on the close cross.

the settings window (`,` or the gear in the top bar) stores labeler DIDs in
`benday:settings`. configured labelers are sent on reads through the
`accept-labelers` header so the appview can attach their labels. labeler
services resolve through the selected appview; imported account labelers come
from the account's saved `labelersPref`.

## feed feedback

on a focused card in a feed or discover deck `+` asks for more posts like it and
`-` asks for less. a less request also slides the card out of the feed. the
request carries the feed URI plus any `feedContext` and `reqId` the generator
supplied. cards from author and search decks do not send feedback.

interactions belong to the feed generator service, not the appview: the client
posts `app.bsky.feed.sendInteractions` to the account's pds with
`atproto-proxy: <generator service did>#bsky_fg` and the pds forwards it. the
service did comes from the generator record's `did` (`getFeedGenerator` view),
so discover targets `did:web:discover.bsky.app`. a generator that explicitly
sets `acceptsInteractions: false`, or whose metadata never resolved a service
did, gets no feedback.

feed and discover decks do not refetch themselves. restoring a cached deck, moving
between tabs, letting a labeler change, or invalidating after a write leaves the
cards alone. the refresh action on the mode-switching card, the refresh card at
the end of the profile deck, and submitting the same search again are the
explicit reloads. refresh resets to the first page and leaves further
paging to scroll.

## notifications

the notifications tab (`/notifications`, or `ctrl`/`cmd` + `←` `→`) is for the
signed-in account and stays out of the top bar while signed out. it lists
follows, likes, reposts, replies, mentions and quotes as cards, newest first,
50 at a time, with the reason in the frame head and the unread marker the
appview supplies. each card shows who acted and when, then the post it points
at — author, age, a three-line excerpt and its reply, like and repost counts —
with a reply's own text above that context. one posts call per page fills the
subject block; if it fails the notification still renders. a reply, mention or
quote opens the new post itself, a like or repost opens the post it landed on,
and a follow opens the profile. up/down
focus rows
and scrolls them into view; enter opens the focused row. opening the tab marks
the list seen in the background using the newest row the pds returned, even
when moderation hid that row from the list; a failed seen update never disturbs
the list.
the refresh button reloads it, and the query also refetches when it is stale on
mount and after reconnecting. notifications are not pushed in realtime.

## profiles

opening a card's author or the top-bar handle reaches `/profile/:actor`, which
adds a temporary tab while you are there. the identity card shows banner,
avatar, name, handle, pronouns, a bot tag, bio, joined date, counts and labels,
plus any profile links whose scheme is `http` or `https`; a link without a title
falls back to its hostname. relationship tags mark `follows you`, `muted`,
`reposts hidden`, `quoteposts hidden` (independent scopes), `blocked` and
`blocked by`.

actions are follow/unfollow, mute/unmute, hide/show reposts, block/unblock and
per-account notifications for new posts and new replies. they need a signed-in
account, update optimistically where it is safe and restore the previous viewer
state on failure. hiding reposts also filters reposts out of the author deck on
this client. the notification control is a themed listbox with all activity,
new posts only, replies only and off. every relationship action, including the
notification control, is hidden on your own profile.

the profile deck has four modes: `profile` (the identity card), `posts`
(standalone posts), `replies` (replies this account wrote) and `media` (posts
carrying images or video). on wide screens the content deck's leading peek card
opens the mode deck and choosing a mode deals the content deck back; below
900px a chip strip switches modes instead. entering the mode deck and returning
to a mode play the same deal animation as the feeds deck. the author feed is
fetched once and the modes filter those loaded pages, so their counts describe
what has been fetched. the refresh card at the end of the deck reloads it.

## search

search is a route (`/search`) reached with `s`; the field offers the same
`@handle` and `#hashtag` suggestions as the composer. it has three modes:
`posts` (text or author match), `users` (accounts by handle or name) and
`feeds` (feed generators, searched through
`app.bsky.unspecced.getPopularFeedGenerators`). a user result opens the profile
and a feed result opens that feed in the feeds view. on wide screens the content
deck's leading peek card opens a search-modes deck and choosing a mode deals
the results back; below 900px a chip strip switches modes instead. submitting
the same query again is the explicit reload. search needs the appview's search
capability, so the public cache and blacksky say so instead of sending the
request.

## settings

settings is the central window for themes appviews labelers account and transfer. open it
with `,` or the gear button. type `/` to focus settings search; keyboard help has its own. appearance selects light dark or system, keeps a
theme choice for each light and dark section, toggles image effects and an
opt-in high-contrast surface, and shows a live preview that splits into light
and dark halves while system is active. high contrast is a separate pass over
the current theme rather than another theme: the normal palettes stay exactly
as they are, boundaries and text go to at least 7:1, texture and glow are
switched off, and the choice travels with a settings export. the
search filters whole sections. the header cross closes the window. settings
written in one tab rehydrate in every other open tab, so theme, appview and
labeler changes follow without a reload.

### settings transfer

the transfer section exports `benday-settings.json` and imports one such file.
export builds the file in memory and downloads it; import replaces the
appearance mode, per-section themes, image-effects and high-contrast choices,
theme, appview and labeler list in a single update, so malformed input leaves
the current settings untouched. errors are reported inline in the dialog.

the file is versioned and intentionally narrow:

```json
{
  "version": 1,
  "exportedAt": "2026-10-30T12:00:00.000Z",
  "theme": "bone",
  "appearance": "light",
  "lightTheme": "bone",
  "darkTheme": "void",
  "imageEffects": true,
  "highContrast": false,
  "appView": {
    "id": "blacksky",
    "label": "blacksky",
    "host": "https://api.blacksky.community",
    "kind": "community",
    "note": "community appview · search is partial"
  },
  "labelers": ["did:plc:…"]
}
```

import validates the version and the portable preferences. theme names are checked
(legacy `duotone` maps to `cyberpunk`); seasonal themes are imported as stored
and the normal availability fallback applies when the month does not match.
appviews are rebuilt from their host, so a file cannot relabel one host as
another preset. labeler dids are trimmed, deduplicated and capped at 20, and
invalid entries are dropped. unknown keys are ignored.

the export never includes session tokens, passwords, oauth/portal data in
indexedDB, jump history, composer drafts, profile/server relationship state or
any other auth material. the same fields are ignored if they appear in an
imported file, so a hand-edited or hostile file cannot inject them into the
settings store. the storage keys and auth persistence are unchanged.

## composing

the composer supports a small inline markdown subset: `**bold**`, `*italic*`,
`_italic_`, `~~strikethrough~~`, `` `code` `` and `[label](https://example.com)`.
closing the composer keeps a draft per post reply or quote target. a successful
send clears it. markers are removed before publishing and converted to atproto
facets with UTF-8 byte offsets. mentions, hashtags and bare urls are still detected by the
atproto rich-text layer. the counter counts the stripped text.

in a thread `←` leaves the thread through the shared app-history back step and
falls back to the feed. `↓` walks the replies in pre-order: a child first when
there is one, then the next visible reply. `↑` moves to the parent reply. at the
opened post `↑` opens the parent post's thread when there is a parent and does
nothing at the root. `j` and `k` stay in flat reading order. escape leaves the
thread from anywhere.

in a thread, `r` or `q` on the focused main card opens a docked composer instead
of the dialog: a quote dock sits above the post and a reply dock below it, and
both wear the dialog's own head and footer chrome so the two placements read as
one box. it
shares the markdown, suggestions, drafts, 300-grapheme counter and
`ctrl`/`cmd` + `enter` send with the dialog; `esc` closes it. the target line
names the author and shows a short excerpt. a thread whose post answers someone
shows an `in reply to @handle` link above the card, with the parent's text when
the appview supplied it.

typing `@` or `#` in the composer or command palette opens handle or hashtag
suggestions from the selected appview. the search field offers the same
suggestions. the feeds tab is home: logged-out readers see the discover feed
only; signed-in accounts default to their first pinned feed and fall back to
discover when there is none. on wide screens the first post hides the feeds
deck behind its left edge; press left or up to enter it. the exposed half shows
the back of the first post card with the feed title post index date and appview.
each feed is a card and left or up from the first feed returns to posts. feed
mode shows the matching posts back on its left edge. mobile keeps the compact
pinned strip.
the `+ add` dialog opens any feed generator. the profile view splits identity
and posts horizontally on wide screens. single images keep their natural
aspect ratio so text stays readable.

## stack

- TypeScript 7.0 in strict mode with `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`,
  `noUnusedLocals`, `noUnusedParameters`, and `moduleResolution: bundler`
- Vite 8 and React 19
- `@atproto/api` 0.29 for public reads, pds sessions, records and viewer state
- `@atproto/oauth-client-browser` 0.5 for the loopback portal login
- TanStack Query 5 for request state and appview-scoped cache keys
- Zustand 5 for persisted settings, auth, per-post action state and dialogs
- Wouter 3 for routes
- IBM Plex Mono for text and chrome and IBM Plex Sans for names and titles, both via `@fontsource`
- Biome for format and lint, Vitest and Testing Library for tests

the dither is an inline SVG filter over the original image: an 8x8 Bayer tile
made with `feImage` and `feTile`, arithmetic threshold in `feComposite`, then a
duotone table for the active theme. this works with the bluesky CDN without CORS
access to image pixels.

## run

the project is developed in a fedora toolbox named `benday`.

```sh
toolbox create benday
toolbox run -c benday sudo dnf install -y git nodejs npm
toolbox run -c benday sudo npm install -g pnpm@12.16.1

toolbox enter benday
cd ~/repos/src/lexa/benday
pnpm install
pnpm dev
```

the dev server listens on `127.0.0.1:5173`. open `http://127.0.0.1:5173/` for
the loopback portal flow; `localhost` serves the password form. the production
build is a static bundle in `dist/`.

```sh
pnpm dev        # vite dev server
pnpm build      # tsc --noEmit plus vite build
pnpm preview    # static preview on 127.0.0.1:4173
pnpm typecheck  # strict tsc pass
pnpm lint         # biome check
pnpm test         # vitest run (jsdom)
pnpm test:browser # vitest browser mode in real chromium
pnpm check        # lint, both suites, then build
```

## layout

```text
src/
  lib/          appviews, atproto reads, model mapping, facets, markdown, time,
                dither, themes, auth, oauth, actions, action store, ui store,
                notifications, profile actions, settings transfer, drafts, feed
                selection, query invalidation, command parsing
  hooks/        bsky queries, pinned feeds, notifications, actor and tag
                suggestions, labeler details, compose form, appview probe, media
                query, hotkeys, input mode, viewer sync
  components/   TUI primitives, DitherImage, Deck, PostCard, ProfileCard, profile
                modes, embeds, inline composer, auth/account/settings/compose
                dialogs, bars and palette
  views/        feeds, search, profile, notifications, thread
  styles/       tokens, base, layout, components, cards, views, dialogs, account,
                notifications, compose, dither, theme-effects
public/         pixel favicon
```

data flow is deliberately small. `atproto.ts` turns a selected appview into an
`AtpAgent` and returns view models. `useBskyQueries.ts` owns request state and
puts the appview host and viewer in every relevant query key. `auth.ts` resolves
the pds, keeps the signed-in agent and persists the session; `oauth.ts` owns the
loopback portal. `actions.ts` owns likes, reposts, replies, quotes and
viewer-state fetches; `markdown.ts` turns composer markers into facets. `Deck`
owns card focus and position memory. `ThreadView` is one full card
with the post and replies inside it. `PostCard` and `ProfileCard` are
presentation.

the per-view header strip was removed on purpose. a visually hidden h1 keeps the
route semantics without adding chrome.

## verification

- `pnpm test` runs the offline jsdom suite (vitest), which covers byte-offset facets and anchor
  composition, post/embed/profile model mapping, hidden-author moderation
  pruning (nested quotes, reply contexts, whole reply subtrees, and the entry cap
  counted after pruning), viewer-scoped author and search page chains,
  markdown-to-facet conversion and wire facet canonicalization, thread
  flattening and reply context, appviews and capabilities, relative time, 8x8
  dither generation, all themes and seasonal availability, pinned-feed
  preferences and selection, mention and tag suggestion freshness and token
  replacement, command parsing, palette precedence, auth transitions and
  did:web discovery, card action auth gates, post action freshness and write
  confirmation, partial viewer-state batches, focused-card shortcuts including
  quoted-post opening, the reply composer and its draft revisions, the feed cache
  guard, per-account read privacy, notification mapping and seen cursors, the
  viewer-state proxy and feed feedback, theme schemes, and settings file
  import/export including high contrast
- `pnpm test:browser` drives real chromium through `vitest.browser.config.ts` with
  trusted keys and real layout: deck focus and scroll memory across axes, shifted-arrow
  consumption with native text selection at both boundaries, the thread's outer
  versus card scrolling, mode-card and card-back geometry at desktop and mobile
  widths, the split theme preview, media fallbacks keeping their declared space,
  and the high-contrast cursor palette
- the built bundle is exercised in a browser at desktop and mobile widths; the
  wide deck is checked as a centred card with half-neighbour peeks, the narrow
  deck as a two-up vertical list, and the thread view as one full card with replies inside
  it
- route changes crossfade through the browser's view transitions api when it is
  present and reduced motion is off; the media viewer stage fades in and deck
  cards fade in when they replace their skeletons. the palette reserves its
  results box, so the window stays put while the debounced suggestions arrive
  and while arrowing through them, and a parked pointer cannot steal the
  selection from the keyboard
- motion is per family: the paper themes rise, the quiet dark themes fade, the
  four october themes settle with a slight tilt and a slower deal, `truth to
  materials` stays still, and cyberpunk keeps its boot and flicker. reduced motion
  turns all of it off
- the dithered themes are checked in the browser, and the undithered bluesky theme and industrial truth theme are checked separately
- the portal button is checked through a live pds authorization redirect; the
  consent page is completed manually, not by the headless harness
- appview switching is checked against the live canonical, public, and
  blacksky hosts
- search is checked against canonical, and the unsupported-public-search state
  is checked explicitly
- password session persistence and viewer-state seeding were checked against
  the live pds in earlier passes
- real likes, reposts, quotes and replies were not posted during verification;
  the write helpers and composer are covered with a mocked client

## limits

- portal login is loopback-only in this static build; a public deployment needs
  hosted oauth client metadata. the password fallback remains
- the composer markdown subset covers inline bold, italic, strikethrough, code
  and links; headings, lists and tables are plain text. benday renders the
  formatting facets itself; the public facet vocabulary is mention/link/tag so
  other clients may only show the stripped text
- autocomplete covers `@handle` mentions and `#hashtag` suggestions in the
  composer and search field; feed URIs use the pinned `+ add` dialog
- pinned feeds appear when the signed-in pds returns saved-feed preferences
- no dms, bookmarks or feed management. notifications are not live: the list
  reloads on mount, after reconnecting and from its refresh button
- two pinned feeds with the same display name are both listed; the feed uri, not
  the name, is the identity
- profile modes describe the author pages fetched so far, not the whole account
- quoted posts show author text and an open link, not the full quoted media; blocked
  or missing quoted posts show a small unavailable placeholder
- the focused card wears two hairlines, one on the edge and one three pixels
  in, so square and clipped themes read the same; hovering a card warms its
  border and nudges its index
- an empty or failed surface carries one dithered `◆` and, where a next step
  exists, one action. a thread indents with a rail per depth. the media viewer
  pages with chevrons and a counter
- video posts show a collapsed poster first; `m` opens a media viewer, and playing mounts a themed hls.js player with native HLS fallback and no caption tracks. a post carrying content labels must be revealed before `m` or `v` acts on its media
- settings search filters whole sections rather than listing individual result buttons
- labeler services are not rendered beyond label tags on cards and profiles
- a thread is flattened to depth 3 and capped at 80 replies, after muted and
  blocked authors and their reply subtrees are removed; the post you opened is
  always kept
- a deck remembers the focused card by its key, so a refresh that inserts or
  drops cards around it keeps the same one under the keys
- wide screens centre the focused card with half-neighbour peeks; narrow
  screens use a two-up vertical list. the leading peek is a sliver, never a
  snap target, and a deck reset by a swap (sign-in) re-centres its first card
  before paint instead of resting on the switcher
- custom appviews and self-hosted pds instances must allow browser cors
- password session tokens live in localStorage; portal tokens live in
  indexedDB. sign out clears both
- some pds implementations do not support app passwords; prefer an app password
  when available and avoid entering a main password on a shared machine
- the public cache and blacksky do not provide search, so the ui disables it for
  those presets instead of pretending the request is supported

## name

benday is named for Ben-Day dots, the halftone printing process that made comic
books and cheap print look the way they do. the spelling keeps the print room
in it.
