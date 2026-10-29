# benday

a dithered tensorpunk reader for the bluesky network

benday is a web client built around cards instead of a timeline. each post is a
square-edged index card with an ordered-dither portrait or image. on a wide
screen one card fills the deck and the deck scrolls horizontally; narrow
screens use a vertical card list. appviews are switchable. the interface
is a small TUI: monospace, one-pixel borders, lowercase labels, keyboard-first,
no rounded corners.

reading is public and needs no account. signing in adds likes, reposts, quotes,
replies, a composer, own-post deletion and the account's pinned feeds. the
client talks to the pds that owns the account and uses the selected appview for
public reads.

no account data is stored on a server owned by this project. ui settings live in
localStorage under `benday:settings` (theme and the selected appview).
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

the sign-in dialog offers the bluesky portal first on a loopback development
origin. it uses the atproto loopback oauth client with
`atproto transition:generic`, so the browser is sent to the pds authorization
page and the password stays with the pds. open the dev server at
`http://127.0.0.1:5173/` for this flow; the oauth client redirects a
`localhost` origin to the loopback IP. a public deployment needs hosted oauth
client metadata before the portal can work there.

the password and app-password form remains as a fallback. this is usually an
app password; some pds implementations do not expose app passwords and require
the account password instead. password session tokens live in localStorage;
portal sessions live in indexedDB. the password is never stored. sign out clears
the session and viewer state. a successful post closes the composer and
refreshes active queries without opening a thread that may not be indexed yet.

portal login is loopback-only in this static build. the password fallback works
where the portal cannot.

## keys and gestures

| key                       | action                                        |
| ------------------------- | --------------------------------------------- |
| `left` `right` or `h` `l` | scan cards on a wide screen                   |
| `up` `down` or `j` `k`    | scan cards on a narrow screen                 |
| `ctrl`/`cmd` + `←` `→`    | switch feeds / search / profile tabs          |
| `g` / `G`                 | first / last card                             |
| `enter` / `space`         | open the focused card's replies               |
| `↓` wide · `→` narrow     | open the full post with an animation          |
| `↑` `↓` in replies        | focus reply rows                              |
| `↑` or `k` in a thread    | close the full post                           |
| `pgup` / `pgdn`           | scroll the focused post                       |
| `shift` + `↑` `↓`         | scroll the focused post                       |
| `esc`                     | close a dialog or back out of replies/profile |
| `enter` on a reply        | open that reply's thread                      |
| `f`                       | like the focused card                         |
| `b`                       | repost the focused card                       |
| `r`                       | reply to the focused card                     |
| `q`                       | quote the focused card                        |
| `d` `d`                   | delete your focused post                      |
| `/` or `ctrl`/`cmd` + `k` | open the jump palette                         |
| `s`                       | go to search and focus the query field        |
| `c`                       | compose a post                                |
| `ctrl`/`cmd` + `enter`    | send from the composer                        |
| `a`                       | switch appview                                |
| `t`                       | open the theme menu                           |
| `v b o p m l d a g h u c` | pick a theme while the menu is open           |
| `?`                       | keyboard help                                 |

the card footer has `re` replies, `like`, `rt` repost, `reply` and `quote`. on
your own posts a two-step `delete` action appears beside them. signed-out clicks
open the sign-in dialog. the top bar has a compose button for signed-in
accounts. the jump palette accepts `@handle`, post and feed `at://` uris,
`#tags` and plain search text, and lists the account's pinned feeds when the
session exposes them. the palette keeps the last five jumps for a quick return. a profile opened
from a card gets a temporary tab after search and loses it when you leave.

## themes

twelve themes share the same dither pipeline: `void`, `bone`, `oxide`,
`phosphor`, `catppuccin mocha`, `catppuccin latte`, `dracula`, `atom one dark`,
`github dark`, `github light`, `duotone` and `cyberpunk 2077`. `t` opens a menu;
each row carries a single-letter shortcut (`v b o p m l d a g h u c`). media is
dithered through an inline svg filter with one duotone table per theme, not
canvas. the ordered dither is an 8x8 Bayer matrix with 64 levels in a 16x16
tile. newer themes use their secondary palette colours for active navigation,
likes, comments and repost marks.

## composing

the composer supports a small inline markdown subset: `**bold**`, `*italic*`,
`_italic_`, `~~strikethrough~~`, `` `code` `` and `[label](https://example.com)`.
markers are removed before publishing and converted to atproto facets with
UTF-8 byte offsets. mentions, hashtags and bare urls are still detected by the
atproto rich-text layer. the counter counts the stripped text.

typing `@` or `#` in the composer or jump palette opens handle or hashtag
suggestions from the selected appview. the search field offers the same
suggestions. the feeds tab is home: logged-out readers see the discover feed
only; signed-in accounts default to their first pinned feed and fall back to
discover when there is none. the `+ add` dialog opens any feed generator. the
profile view splits identity and posts horizontally on wide screens. single
images keep their natural aspect ratio so text stays readable.

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
- IBM Plex Mono via `@fontsource`
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

the dev server listens on `0.0.0.0:5173`. open `http://127.0.0.1:5173/` for the
loopback portal flow; the production build is a static bundle in `dist/`.

```sh
pnpm dev        # vite dev server
pnpm build      # tsc --noEmit plus vite build
pnpm preview    # static preview on 0.0.0.0:4173
pnpm typecheck  # strict tsc pass
pnpm lint       # biome check
pnpm test       # vitest run
pnpm check      # lint, tests, then build
```

## layout

```text
src/
  lib/          appviews, atproto reads, model mapping, facets, markdown, time,
                dither, themes, auth, oauth, actions, action store, ui store,
                command parsing
  hooks/        bsky queries, pinned feeds, actor and tag suggestions, appview
                probe, media query, hotkeys, input mode, viewer sync
  components/   TUI primitives, DitherImage, Deck, PostCard, ProfileCard,
                embeds, auth/account/compose dialogs, bars and palette
  views/        feeds, search, profile, thread
  styles/       tokens, base, layout, components, cards, views, dialogs, account,
                dither
public/         pixel favicon
```

data flow is deliberately small. `atproto.ts` turns a selected appview into an
`AtpAgent` and returns view models. `useBskyQueries.ts` owns request state and
puts the appview host and viewer in every relevant query key. `auth.ts` resolves
the pds, keeps the signed-in agent and persists the session; `oauth.ts` owns the
loopback portal. `actions.ts` owns likes, reposts, replies, quotes and
viewer-state fetches; `markdown.ts` turns composer markers into facets. `Deck`
owns full-card horizontal focus and position memory. `ThreadView` is one full card
with the post and replies inside it. `PostCard` and `ProfileCard` are
presentation.

the per-view header strip was removed on purpose. a visually hidden h1 keeps the
route semantics without adding chrome.

## verification

- 118 offline unit tests cover byte-offset facets, markdown-to-facet conversion,
  thread flattening and reply context, appviews, relative time, 8x8 dither
  generation, all themes, pinned-feed preferences, mention detection, command
  parsing, palette precedence, card action auth gates, focused-card shortcuts,
  the reply composer and the appview proxy used for viewer state
- the built bundle is exercised in a browser at desktop and mobile widths; the
  wide deck is checked as full-width horizontal cards, and the thread view is
  checked as one full card with replies inside it
- theme letters and the 12-theme dither filters are checked in the browser
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
- no notifications, dms, follows, bookmarks or feed management
- quoted posts show text and the embed kind, not the full quoted media; blocked
  or missing quoted posts show a small unavailable placeholder
- video posts show the poster and alt text; there is no player
- labeler services are not rendered beyond label tags on cards and profiles
- a thread is flattened to depth 3 and capped at 80 replies
- wide screens show one full card at a time and scan horizontally; narrow
  screens use a vertical card list
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
