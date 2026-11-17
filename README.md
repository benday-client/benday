# benday

a dithered tensorpunk client for the bluesky network

benday is a web client built around cards instead of a timeline. each post is a
square-edged index card with a portrait or image, dithered by default. on a wide
screen the focused card sits in the centre with half-neighbour peeks on either
side; narrow screens use a two-up vertical card list. the interface is a small
TUI: monospace body and chrome, one-pixel borders, lowercase labels,
keyboard-first, square corners by default. names and card titles set in a second
proportional face so they read apart from the monospace text.

an account is required. while the session restores the shell shows progress;
without one it shows the sign-in gate. signing in adds likes, reposts, replies,
a composer, own-post deletion, notifications, follow/mute/block controls and the
account's pinned feeds. content reads go to the official `api.bsky.app` origin;
writes and viewer state go through the signed-in account's pds.

no account data is stored on a server owned by this project. ui settings live in
localStorage under `benday:settings`, which holds only the appearance mode, the
keyboard-shortcuts flag and the dither-effects flag. settings can be exported to
and imported from `benday-settings.json`; that file holds only those portable
preferences and never sessions or credentials. composer drafts live under
`benday:drafts` scoped by account did. password session tokens live under
`benday:session`; portal sessions live in the browser's indexedDB. the password
is never stored.
search terms are sent to `api.bsky.app` when you search.

## access

the sign-in dialog offers the bluesky portal on the `127.0.0.1` and `[::1]`
loopback origins and on the https origin configured at build time (see
[deploy](#deploy)). it requests `atproto transition:generic`, so authorization
happens on the pds and the password stays with the pds.

open the dev server at `http://127.0.0.1:5173/` for the loopback oauth client.
a `localhost` origin keeps the password form, because the oauth client would
rewrite it to the loopback IP and orphan the localhost origin's stored session
and settings.

the deployment uses one hosted client identity across routes and returns to
`/feed`. any other origin keeps the password form.

the password and app-password form remains as a fallback. this is usually an
app password; some pds implementations do not expose app passwords and require
the account password instead. the handle resolves to its pds automatically.
password session tokens live in localStorage; portal sessions live in indexedDB.
the password is never stored. sign out clears the session and viewer state, so
the next load returns to the gate. a successful post closes the composer and
invalidates the loaded non-feed queries without opening a thread that may not be
indexed yet.
a failed portal restore stays visible above the active route even when the
password fallback succeeds; it does not open a dialog.

## keys and gestures

| key                     | action                                                          |
| ----------------------- | --------------------------------------------------------------- |
| `←` `→`                 | previous / next card on a wide deck; `→` opens on a narrow deck |
| `↑` `↓`                 | previous / next card on a narrow deck; `↓` opens on a wide deck |
| back at the first card  | `←` on a wide deck, `↑` on a narrow deck                        |
| back at the first post  | the same back key exits the posts deck for the feeds deck       |
| back at the first feed  | the same back key exits the feeds deck back to the posts deck   |
| `home` / `end`          | first / last card, or first / last reply                        |
| `g` / `G`               | first / last card                                               |
| `1`-`9`                 | focus the nth card in the active deck, or the nth reply         |
| `enter`                 | open the focused card or reply                                  |
| `pgup` / `pgdn`         | scroll the focused post                                         |
| `shift` + `↑` `↓`       | scroll the focused post; always owned by the deck               |
| `esc`                   | the escape stack below                                          |
| `m`                     | open the focused post's media                                   |
| `v`                     | play or pause the focused video                                 |
| `x`                     | reveal labelled media before `m` or `v`                         |
| `o`                     | open the focused post's quoted post                             |
| `y`                     | copy a bsky.app link to the focused post                        |
| `R`                     | arm a feed refresh; press again within five seconds to reload   |
| `f` / `b`               | like / repost the focused card                                  |
| `r`                     | reply to the focused card, in its thread                        |
| `+` / `-`               | more / less like this on an eligible pinned feed                |
| `d` then `enter` or `d` | delete your focused post; `esc` cancels, 4s disarm              |
| `ctrl`/`cmd` + `k`      | command palette, the same chord closes it                       |
| `/` (or `s`)            | go to search and focus the query field                          |
| `c`                     | compose a post                                                  |
| `,`                     | settings                                                        |
| `?`                     | tap for keyboard help, hold for key badges                      |
| `ctrl`/`cmd` + `←` `→`  | switch feeds / search / notifications tabs, plus a profile tab  |

the deck has no letter movement: `h`, `j`, `k` and `l` do nothing on a deck.
threads still use `j` and `k` for flat reading order. the media viewer is
arrow-only: `←` `→`, `Home`/`End` and the digit positions.
tab gives the deck an inset keyboard focus ring and an accessible description
of its current position. on a wide deck, right from the leading peek enters the
first card; left from that peek leaves the deck.

escape stops at the first layer it can close: an open dialog, then the composer's
suggestion list, then the inline composer, then a mode switcher, then a search
field with text (clear it, then blur), then back out of a thread or profile or
return to the previous tab. a feed deck has nowhere above it, so escape never
leaves it.

the top bar keeps the tab names: `feeds`, `search`, `notifications` and
`@handle` for the open profile. the active one carries a `//` marker. every
action on the right prints its word — `compose`, `jump`, `help`, `settings` — and the
chords stay off the bar until you hold `?`; on a phone the row wraps instead of
dropping the words. holding `?` paints
key badges over the top bar actions and the focused card's actions, and releasing
it removes them; a tap still opens the keyboard help. the card footer has `re`
replies, `like`, `rt` repost, `r` reply and `copy link`; `m` opens the focused
post's media in the viewer. clicking a quoted post opens its thread; its open
link still navigates independently. on your own posts a two-step `delete`
action appears beside them. `y` copies the post's bsky.app permalink, and
`1`-`9` are 1-based positions that act only while the deck or thread owns focus.
compose and jump stay disabled until an account is authenticated. help and
settings remain available while signed out; the sign-in card opens login.

the command palette accepts `@handle`, post `at://` uris, `#tags` and plain
search text (enter searches when no command matches). a feed-generator `at://`
uri is not opened as a feed; it becomes search text. the palette lists pinned
feeds, account suggestions and the last five jumps, and with an empty prompt it
lists compose, account, feeds, search, settings and keyboard help. `@me` opens
your own profile. a profile opened from a card gets a temporary tab after
notifications and loses it when you leave. search is a tab between feeds and
notifications in the arrow cycle, and `/` or `s` still jumps to it from any
route. there are no theme or appview commands.

## feeds

the feeds tab is home and lists only the account's pinned feeds, in stored
order. signed-in accounts open their first pinned feed; the view has no discover
fallback and no add-feed dialog. an empty pinned list shows the no-feeds state.
a `?uri=` selects a feed only when it names one of the pins; any other value
resolves to the first pinned feed. on wide screens the first post hides the
feeds deck behind its left edge; press left to enter it. the exposed half
shows the back of the first post card with the feed title, post index, date
and its `← feeds` hint. each feed is a card showing avatar, name and
description, and left from the first feed returns to posts. feed mode shows the
matching posts back on its left edge. mobile keeps the compact pinned strip.

`R` or the narrow refresh button (which reads `press R to refresh`) arms a
five-second confirmation: the status note says `press R again to refresh` and the
button says `refresh again`. a
second press in that window reloads only the first page and clears locally
dismissed cards; waiting, escape, changing feeds or leaving the view cancels.
arming is unavailable while a refresh runs or the pins are unresolved. there is
no polling and no automatic refresh.

## themes

catppuccin mocha (dark) and latte (light) are the fixed pair; the appearance
mode chooses between them and a system mode follows the browser preference.
there is no palette picker, no seasonal availability and no live preview.
catppuccin signs the reading card itself: a pastel head wash and a one-pixel
accent rule on the author band, four-pixel corner rounding on frames, cards and
dialogs, and a short reduced-motion-guarded lift on dialogs. mocha rises less
than latte, which rises a little further and slower.

every static image uses one inline svg filter with a duotone table per
palette, not canvas: avatars, banners, post and embed images, thumbnails,
video posters, failed-image fallbacks and the enhanced viewer.
the `dither effects` switch under appearance decides whether it runs: on, those
static images and video posters carry the grunge dither; off, they paint plainly
with no filter and no pixelated scaling. playing video frames are never filtered
in either state. the ordered dither is an 8x8 Bayer matrix with 64 levels in a
16x16 tile, mixed with a fixed grunge noise and painted from the palette's
duotone. there is no effect-family choice; the filter does not send image
pixels anywhere.

single images scale to fit the viewport while keeping their natural ratio.
there are no scanline, grain or surface-texture layers, no painted cursors, no
keyboard pointer hiding and no high-contrast mode; the palettes keep their
mandatory readable baseline contrast.
video starts from its poster and uses the same play/pause transport for clicks
and `v`. loading or failed video cannot be played through that shortcut; a load
failure keeps its explicit retry. seeking follows the video's duration as it
becomes known, including in the media viewer.

## labelers

labeler dids come from the signed-in account's `app.bsky.actor.getPreferences`
`labelersPref` when the account is established by sign-in, restore or switch.
they are applied to that account's reads through the `accept-labelers` header,
so `api.bsky.app` can attach their labels. there is no local labeler list,
editor or import. malformed dids are dropped; a failed preference read applies
no labelers and never reuses another account's list.
the active account keeps its list during a replacement sign-in attempt and
after a failure that retains its session. signing in again as the same account
keeps it too; committing a different account clears it before the new
preferences arrive.

## feed feedback

on a focused card in an eligible pinned feed `+` asks for more posts like it and
`-` asks for less. a less request slides the card out only after the generator
accepts it; a completed refresh clears local dismissals. the request carries the
feed uri plus any `feedContext` and `reqId` the generator supplied. author and
search decks do not send feedback, and discover is gone.

interactions belong to the feed generator service, not the public appview: the
client posts `app.bsky.feed.sendInteractions` to the account's pds with
`atproto-proxy: <generator service did>#bsky_fg` and the pds forwards it. the
service did comes from the generator record's `did` (`getFeedGenerator` view).
a generator that explicitly sets `acceptsInteractions: false`, or whose
metadata never resolved a service did, gets no feedback.

feed decks do not refetch themselves. restoring a cached deck, moving between
tabs or invalidating after a write leaves the cards alone. the explicit
two-step refresh and submitting the same search again are the reloads. refresh
resets to the first page and leaves further paging to scroll.

## notifications

the notifications tab (`/notifications`, or `ctrl`/`cmd` + `←` `→`) is for the
signed-in account. it lists follows, likes, reposts, replies, mentions and
quotes as cards, newest first, 50 at a time, with the reason in the frame head
and the unread marker the appview supplies. each card shows who acted and when,
then the post it points at — author, age, a three-line excerpt and its reply,
like and repost counts — with a reply's own text above that context. subjects
hydrate in 25-row `getPosts` chunks, so a full 50-row page costs more than one
call; a failed chunk leaves only its own rows without context. a reply,
mention or quote opens the new post itself, a like or repost opens the post it
landed on, and a follow opens the profile. up/down focus rows and scrolls them
into view; enter opens the focused row. opening the tab marks the list seen in
the background using the newest row the pds returned, even when moderation hid
that row from the list; a failed seen update never disturbs the list.

there is no unread/shown count in the header, no header refresh button and no
refresh action in the empty state. the query refetches when it is stale on
mount and after reconnecting. retry keeps the error and its focused button on
screen while loading; recovery hands that lost focus to the list or empty view
without taking it from another selected control. no polling, filters, load-more
or push.

## profiles

opening a card's author or the top-bar handle reaches `/profile/:actor`, which
adds a temporary tab while you are there. the identity card shows banner,
avatar, name, handle, pronouns, a bot tag, bio, declared links whose scheme is
`http` or `https`, and follows-you, mute-scope and block badges. a link without
a title falls back to its hostname. follower, following and post totals, the
joined date and standalone account-label badges are not shown. relationship tags
mark `follows you`, `muted`, `reposts hidden`, `quoteposts hidden` (independent
scopes), `blocked` and `blocked by`.

actions are follow/unfollow, mute/unmute and block/unblock.
they need a signed-in account, update optimistically where it is safe and
restore the previous viewer state on failure. a stored `reposts hidden` scope
still filters repost entries out of the author deck on this client, and nothing
here changes it. the per-profile notification subscription control is not shown;
stored subscription state is preserved and incoming notifications still read
truthfully. every relationship action is hidden on your own profile.

the profile deck has four modes: `profile` (the identity card), `posts`
(standalone posts), `replies` (replies this account wrote) and `media` (the
author's own posts carrying images or video, including authored media replies,
excluding repost entries including self-reposts). identity is first. on wide
screens the content deck's leading peek card opens the mode deck and choosing a
mode deals the content deck back; below 900px a chip strip switches modes
instead. entering the mode deck and returning to a mode play the same deal
animation as the feeds deck. the author feed is fetched once and the modes
filter those loaded pages, so their counts describe what has been fetched. the
refresh card at the end of the deck reloads it.

## search

search is a tab (`/search`) between feeds and notifications, and `/` or `s`
reaches it from any route. it has two modes: `posts` (text
or author match) and `users` (accounts by handle or name); only the active target
fetches. a user result opens the profile. on wide screens the content deck's
leading peek card opens a search-modes deck and choosing a mode deals the
results back; below 900px a chip strip switches modes instead. the field
suggests accounts only. typing `#tag` does not open tag suggestions; the typed
text searches as an ordinary text query. submitting the same query again is the
explicit reload.

## settings

settings is the central window for appearance, account and transfer. open it
with `,` or the settings button. type `/` to focus settings search. appearance
selects system, light or dark, toggles single-key shortcuts (`keyboard
shortcuts`, on by default) and toggles the image dither (`dither effects`, on by
default). with dither effects on, static images and video posters carry the
palette's grunge ordered dither; off, they paint plainly. playing video frames
are never filtered. bare printable keys stop firing with the shortcut switch
off, while arrows, enter, escape, page keys and every modifier chord keep
working. the palette chord stays reachable, and so does the settings dialog's
own `/` search; the global `/` search follows the setting.

the search filters whole sections and shows its own empty state. appearance's
search keywords cover the switch terms (`dither`, `grunge`, `image effects`,
`dither effects`). the header cross closes the window. settings written in one
tab rehydrate in every other open tab, so appearance, shortcut and dither
changes follow without a reload. a window opens with focus on its first field,
or on the window itself when it has none, never on the close cross.

### settings transfer

the transfer section exports `benday-settings.json` and imports one such file.
export builds the file in memory and downloads it; import replaces the
appearance mode, keyboard-shortcuts and dither-effects choices in a single
update, so malformed input leaves the current settings untouched. errors are
reported inline in the dialog. the dialog refuses files over 256 KiB.
each new file pick supersedes any older pending read, even when the newer file
is refused for its size. cancelling the picker leaves the pending read alone.

the file is versioned and intentionally narrow:

```json
{
  "version": 3,
  "exportedAt": "2026-10-30T12:00:00.000Z",
  "appearance": "system",
  "keyboardShortcuts": true,
  "imageEffects": true
}
```

import accepts versions 1, 2 and 3. a missing or invalid `appearance` is derived
from the old `theme` field's scheme when possible, then falls back to `system`;
a missing `keyboardShortcuts` or `imageEffects` defaults to `true`, and an
explicit boolean in the file is honored. every retired field — themes,
per-section palettes, high contrast, appview and labelers — is ignored, as are
credential-shaped keys. versions above 3 are rejected with a truthful message,
as are non-objects and malformed json. such a field is ignored even when it
appears in an imported file, so a hand-edited or hostile file cannot inject it
into the settings store.

the export never includes session tokens, passwords, oauth/portal data in
indexedDB, jump history, composer drafts, profile/server relationship state or
any other auth material.

## composing

the standalone composer and the inline reply composer are the only composers.
every reply action opens the target's thread and focuses its inline composer;
there is no reply dialog and no quote composer. the inline dock sits below the
post and wears the dialog's own head and footer chrome. it shares the
suggestions, drafts, 300-grapheme counter and `ctrl`/`cmd` + `enter` send with
the standalone composer; `esc` closes it. the target line names the author and
shows a short excerpt. a thread whose post answers someone shows an `in reply
to @handle` link above the card, with the parent's text when the appview
supplied it.

text is published literally. the composer keeps a small inline markdown subset
as plain text: `**bold**`, `*italic*`, `_italic_`, `~~strikethrough~~` and
`` `code` `` are not converted to style facets, so their markers appear in the
post. explicit `[label](https://example.com)` links publish `label` with a
standard link facet, and mentions, hashtags and bare urls are still detected by
the atproto rich-text layer. incoming bold, italic, strike and code still render.
the counter counts the literal text.

typing `@` in the composer or command palette opens account suggestions; there
are no hashtag suggestions. closing the composer keeps a draft per post or
reply target. a successful send clears it. drafts are account-owned, survive
sign-out for the same account and are evicted oldest-updated beyond 20.
at startup the client deletes legacy quote drafts and all signed-out draft
records once; if draft storage is unreadable it deletes nothing.

in a thread `←` leaves the thread through the shared app-history back step and
falls back to the feed. `↓` walks the replies in pre-order: a child first when
there is one, then the next visible reply. `↑` moves to the parent reply; at the
opened post `↑` does nothing and never opens the parent thread. `p` is the only
parent-post opener. `j` and `k` stay in flat reading order. escape leaves the
thread from anywhere.

quoted posts still read: the card shows the quoted author, text and media, and
`o` or the quoted control opens it in its own thread. quote creation is absent
from the card, composer and help.

## stack

- TypeScript 7.0 in strict mode with `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`,
  `noUnusedLocals`, `noUnusedParameters`, and `moduleResolution: bundler`
- Vite 8 and React 19
- `@atproto/api` 0.29 for public reads, pds sessions, records and viewer state
- `@atproto/oauth-client-browser` 0.5 for loopback and deployed portal login
- TanStack Query 5 for request state and cache keys
- Zustand 5 for persisted settings, auth, per-post action state and dialogs
- Wouter 3 for routes
- IBM Plex Mono for text and chrome and IBM Plex Sans for names and titles, both via `@fontsource`
- Biome for format and lint, Vitest and Testing Library for tests

the dither is an inline SVG filter over the original image: an 8x8 Bayer tile
made with `feImage` and `feTile`, arithmetic threshold in `feComposite`, then a
duotone table for the active palette. this works with the bluesky CDN without
CORS access to image pixels.

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
pnpm check        # lint, assertion check, both suites, then build
```

## deploy

the target deployment origin is `https://benday.qex.at`. publish `dist/` at the
origin root over https; the app uses root-relative assets and routes. configure
dns for `benday.qex.at` to reach the static host and provision a valid tls
certificate before enabling the public portal flow.

build for that origin, which is the default:

```sh
BENDAY_PUBLIC_ORIGIN=https://benday.qex.at pnpm build
```

an unset `BENDAY_PUBLIC_ORIGIN` builds for `https://benday.qex.at`; set it
to mint metadata for a different deployment. it accepts an https origin without
a path, query, fragment, credentials or nondefault port. every build emits
`dist/oauth-client-metadata.json` and embeds its client id in the app. the
metadata's client id is
`https://benday.qex.at/oauth-client-metadata.json` and its redirect uri is
`https://benday.qex.at/feed`. changing the deployment origin requires rebuilding;
setting an environment variable on an already-built static host changes nothing.

serve existing files before applying the single-page-app fallback.
`/oauth-client-metadata.json` must be publicly fetchable as json, with an
`application/json` content type, rather than returning `index.html` or a sign-in
page. deploy the metadata and app from the same build.

`/feed` is the canonical portal callback. direct requests to `/feed` must return
the app's `index.html` and keep the callback query string intact. the other
client routes need the same html fallback so opening or reloading a route works.
check both the metadata response and `/feed` after publishing; a successful
build alone does not verify the host's routing or content types.

the authorization response arrives in the url fragment
(`response_mode=fragment`), so `code` and `state` never reach the host. the
browser client consumes and clears that fragment before routing; a rejected
callback is still consumed and its query string is left intact. the host only
needs the html fallback for `/feed` and must preserve ordinary query strings
such as `/thread?uri=…`.

inspect the status, content type and response body on the actual host:

```sh
curl --fail --show-error --include https://benday.qex.at/oauth-client-metadata.json
curl --fail --show-error --include 'https://benday.qex.at/feed?deployment-check=1'
```

live verification is pending. on 2026-11-17, `benday.qex.at` did not resolve
from the development environment. once dns and hosting are available, verify
the public metadata response, direct `/feed` navigation, portal sign-in and
session restore after reloading on that origin. local checks do not substitute
for those live checks.

the metadata response must return `200` directly, with no redirect and no
`location` header; a redirect breaks client metadata resolution.

## layout

```text
src/
  lib/          atproto reads, model mapping, facets, markdown, time, dither,
                themes, auth, oauth, actions, action store, ui store,
                notifications, profile actions, account labelers, settings
                transfer, drafts, feed selection, query invalidation, command
                parsing, keymap
  hooks/        bsky queries, pinned feeds, notifications, actor suggestions,
                compose form, media query, hotkeys, deal flash, viewer sync
  components/   TUI primitives, DitherImage, Deck, PostCard, ProfileCard, profile
                modes, embeds, inline composer, auth/account/settings/compose
                dialogs, bars and palette
  views/        feeds, search, profile, notifications, thread
  styles/       tokens, base, layout, components, cards, views, dialogs, account,
                notifications, compose, dither, theme-effects
public/         pixel favicon
```

data flow is deliberately small. `atproto.ts` reads `api.bsky.app` and returns
view models; `useBskyQueries.ts` owns request state and puts the viewer in every
relevant query key. `auth.ts` resolves the pds, keeps the signed-in agent and
persists the session; `oauth.ts` owns the portal. `accountLabelers.ts`
holds the current account's labeler dids and `labelers.ts` applies them to an
agent. `actions.ts` owns likes, reposts, replies and viewer-state fetches;
`markdown.ts` maps labelled links to facets. `Deck` owns card focus and position
memory. `ThreadView` is one full card with the post and replies inside it.
`PostCard` and `ProfileCard` are presentation.

the per-view header strip was removed on purpose. a visually hidden h1 keeps the
route semantics without adding chrome.
