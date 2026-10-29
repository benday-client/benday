# benday

a dithered tensorpunk reader for the bluesky network

benday is a web client built around cards instead of a timeline. each post is a
square-edged index card with an ordered-dither portrait or image. appviews are
switchable. the flow is horizontal on laptops and vertical on mobile. the
interface is a small TUI: monospace, one-pixel borders, lowercase labels,
keyboard-first, no rounded corners.

reading is public and needs no account. signing in adds likes, reposts, quotes,
replies and a composer. the client talks to the pds that owns the account and
uses the selected appview for public reads.

no account data is stored on a server owned by this project. the only persisted
state is local: ui settings in localStorage under `benday:settings` (theme, flow
and the selected appview) and session tokens after sign-in under
`benday:session`. the password is never stored. search terms are sent to the
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
signed-in account's pds.

## auth

signing in uses the password accepted by the pds. this is usually an app
password; some pds implementations do not expose app passwords and require the
account password instead. use an app password whenever the pds supports one.
the client stores access and refresh tokens in localStorage after sign-in and
never stores the password. sign out clears the session and viewer state.

login is password based, not oauth. a static localhost build has no public oauth
client metadata host.

## keys and gestures

| key                               | action                                 |
| --------------------------------- | -------------------------------------- |
| `left` `right` or `h` `l`         | scan cards on a wide screen            |
| `up` `down` or `j` `k`            | scan cards on a narrow screen          |
| `down` on wide, `right` on narrow | open the focused post's comments       |
| `g` / `G`                         | first / last card                      |
| `enter`                           | open the focused card's thread         |
| `/` or `ctrl`/`cmd` + `k`         | open the jump palette                  |
| `s`                               | go to search and focus the query field |
| `c`                               | compose a post                         |
| `a`                               | switch appview                         |
| `t`                               | cycle themes                           |
| `f`                               | cycle flow                             |
| `?`                               | keyboard help                          |
| `esc`                             | close a dialog                         |

the card footer has `re` comments, `like`, `rt` repost, `reply` and `quote`.
signed-out clicks open the sign-in dialog. active likes and reposts are marked
in the footer and counts update while the session is live. the jump palette
accepts `@handle`, post and feed `at://` uris, `#tags` and plain search text.

## themes

four monochrome themes share the same dither pipeline: `void` (blue on black),
`bone` (ink on paper), `oxide` (amber on warm black) and `phosphor` (green on
black). `t` cycles them. media is dithered through an inline svg filter with
four duotone tables, not canvas.

## stack

- TypeScript 7.0 in strict mode with `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`,
  `noUnusedLocals`, `noUnusedParameters`, and `moduleResolution: bundler`
- Vite 8 and React 19
- `@atproto/api` 0.29 for public reads, pds sessions, records and viewer state
- TanStack Query 5 for request state and appview-scoped cache keys
- Zustand 5 for persisted settings, auth, per-post action state and dialogs
- Wouter 3 for routes
- IBM Plex Mono via `@fontsource`
- Biome for format and lint, Vitest and Testing Library for tests

the dither is an inline SVG filter over the original image: a 4x4 Bayer tile
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

the dev server listens on `0.0.0.0:5173`. the production build is a static
bundle in `dist/`.

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
  lib/          appviews, atproto reads, model mapping, facets, time, dither,
                themes, auth, actions, action store, ui store, command parsing
  hooks/        bsky queries, appview probe, media query, hotkeys, viewer sync
  components/   TUI primitives, DitherImage, Deck, PostCard, ProfileCard,
                embeds, auth/account/compose dialogs, bars and palette
  views/        discover, search, profile, thread, feed
  styles/       tokens, base, layout, components, cards, views, dialogs, account,
                dither
public/         pixel favicon
```

data flow is deliberately small. `atproto.ts` turns a selected appview into an
`AtpAgent` and returns view models. `useBskyQueries.ts` owns request state and
puts the appview host in every query key. `auth.ts` resolves the pds, keeps the
signed-in agent and persists the session. `actions.ts` owns likes, reposts,
replies, quotes and viewer-state fetches. `Deck` owns flow, focus and the
comment/start/end gestures. `PostCard` and `ProfileCard` are presentation.

the per-view header strip was removed on purpose. a visually hidden h1 keeps the
route semantics without adding chrome.

## verification

- 87 offline unit tests cover byte-offset facets, thread flattening and
  mapping, appviews, relative time, dither generation, themes, command parsing,
  palette precedence, card action auth gates and the reply composer
- the built bundle is exercised in a browser at desktop and mobile widths
- appview switching is checked against the live canonical, public, and
  blacksky hosts
- search is checked against canonical, and the unsupported-public-search state
  is checked explicitly
- login, session persistence and viewer-state seeding are checked against the
  live pds
- real likes, reposts, quotes and replies were not posted during verification;
  the write helpers and composer are covered with a mocked client

## limits

- password login, not oauth
- no notifications, dms, follows, bookmarks or feed management
- quoted posts show text and the embed kind, not the full quoted media
- video posts show the poster and alt text; there is no player
- labeler services are not rendered beyond label tags on cards and profiles
- a thread is flattened to depth 3 and capped at 80 cards
- custom appviews and self-hosted pds instances must allow browser cors
- session tokens live in localStorage while signed in; sign out clears them
- some pds implementations do not support app passwords; prefer an app password
  when available and avoid entering a main password on a shared machine
- the public cache and blacksky do not provide search, so the ui disables it for
  those presets instead of pretending the request is supported

## name

benday is named for Ben-Day dots, the halftone printing process that made comic
books and cheap print look the way they do. the spelling keeps the print room
in it.
