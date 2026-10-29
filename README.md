# benday

a dithered tensorpunk reader for the bluesky network

benday is a web client built around cards instead of a timeline. each post is a
square-edged index card with an ordered-dither portrait or image. appviews are
switchable. no account data is stored. the only persisted state is local ui
settings in localStorage under `benday:settings` (theme, flow, and the selected
appview). search terms are sent to the selected appview when you search.

the flow is horizontal on laptops and vertical on mobile. switching appviews
refetches the current view from that host. the interface is a small TUI:
monospace, one-pixel borders, lowercase labels, keyboard-first, no rounded
corners.

benday is read-only by design. it reads public atproto endpoints and links out
to bsky.app for liking, replying, following and other writes.

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

## keys

| key                       | action                                 |
| ------------------------- | -------------------------------------- |
| `left` `right` or `h` `l` | scan cards on a wide screen            |
| `up` `down` or `j` `k`    | scan cards on a narrow screen          |
| `home` `end`              | jump to the deck edges                 |
| `enter`                   | open the focused card's thread         |
| `/` or `ctrl`/`cmd` + `k` | open the jump palette                  |
| `a`                       | switch appview                         |
| `t`                       | toggle the void/bone theme             |
| `f`                       | cycle flow: auto, horizontal, vertical |
| `?`                       | keyboard help                          |
| `esc`                     | close a dialog                         |

arrow navigation is global except while typing in a field or while a dialog is
open. the jump palette accepts `@handle`, post and feed `at://` uris, `#tags`,
and plain search text.

## stack

- TypeScript 7.0 in strict mode with `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`,
  `noUnusedLocals`, `noUnusedParameters`, and `moduleResolution: bundler`
- Vite 8 and React 19
- `@atproto/api` 0.29 for public xrpc reads
- TanStack Query 5 for request state and appview-scoped cache keys
- Zustand 5 for persisted theme, flow, and appview selection
- Wouter 3 for routes
- IBM Plex Mono via `@fontsource`
- Biome for format and lint, Vitest and Testing Library for tests

the dither is not canvas and not a remote image proxy. it is an inline SVG
filter over the original image: a 4x4 Bayer tile made with `feImage` and
`feTile`, arithmetic threshold in `feComposite`, then a duotone table for the
void and bone themes. this works with the bluesky CDN without CORS access to
image pixels.

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
                command parsing, persisted settings
  hooks/        bsky queries, appview probe, media query, hotkeys
  components/   TUI primitives, DitherImage, Deck, PostCard, ProfileCard,
                embeds, dialogs, top and status bars
  views/        discover, search, profile, thread, feed
  styles/       tokens, base, layout, components, cards, views, dialogs, dither
public/         pixel favicon
```

data flow is deliberately small. `atproto.ts` turns a selected appview into an
`AtpAgent` and returns view models. `useBskyQueries.ts` owns request state and
puts the appview host in every query key, so a switch refetches. `Deck` owns
horizontal/vertical flow and focus. `PostCard` and `ProfileCard` are pure
presentation.

## verification

- 78 offline unit tests cover byte-offset facets, thread flattening and
  mapping, appviews, relative time, dither pattern generation, command
  parsing, and command-palette keyboard behavior
- the built bundle is exercised in a browser at desktop and mobile widths
- appview switching is checked against the live canonical, public, and
  blacksky hosts
- search is checked against canonical, and the unsupported-public-search state
  is checked explicitly

## limits

- read-only: no login, likes, replies, reposts, follows, notifications or DMs
- quoted posts show text and the embed kind, not the full quoted media
- video posts show the poster and alt text; there is no player
- labeler services are not rendered beyond label tags on cards and profiles
- a thread is flattened to depth 3 and capped at 80 cards
- a custom appview must allow browser CORS; failures are shown in the card area
- the public cache and blacksky do not provide search, so the UI disables it for
  those presets instead of pretending the request is supported

## name

benday is named for Ben-Day dots, the halftone printing process that made comic
books and cheap print look the way they do. the spelling keeps the print room
in it.
