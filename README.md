# benday

A keyboard-first Bluesky web client built around a deck of cards, with dithered
images and light, dark and system appearance modes. Built with React, TypeScript
and Vite.

## Features

- Read your pinned feeds, threads and profiles.
- Search posts and accounts, and check notifications.
- Compose posts and replies, like, repost and manage follows, mutes and blocks.
- Use keyboard navigation and the command palette; press `?` for built-in help.

A Bluesky account is required. Preferences, drafts and sessions are stored in
your browser; the app does not store account data on a project-owned server.
Passwords are never stored.

## Getting started

Use **Node.js 24.15.0 or newer within the 24.x LTS line** and **pnpm 12.16.1**.
The supported Node ranges are `^22.22.2 || ^24.15.0 || >=26.0.0`.

```sh
git clone https://github.com/lexa-qexat/benday.git
cd benday
pnpm install
pnpm dev
```

Open <http://127.0.0.1:5173/> for portal (OAuth) sign-in. Using `localhost`
instead keeps the password/app-password form.

## Development

```sh
pnpm typecheck     # TypeScript checks
pnpm lint          # Biome checks
pnpm test          # Unit and component tests
pnpm test:quality  # Repository quality checks
pnpm test:browser  # Browser tests in Chromium
pnpm check         # All checks, tests and production build
pnpm build         # Production files in dist/
pnpm preview       # Preview the build at http://127.0.0.1:4173/
```

Install the browser test runtime with `pnpm exec playwright install chromium`
before running browser tests or `pnpm check`. For contributions, run
`pnpm check` before opening a pull request.

## Deployment

Deployment runs from **this repository** through
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), using the
`HOST`, `USER` and `PASS` GitHub Actions secrets configured in
[`lexa-qexat/benday`](https://github.com/lexa-qexat/benday). The workflow builds
the app and uploads it using the existing `ssh-scp-ssh` action pattern.

For a manual build:

```sh
BENDAY_PUBLIC_ORIGIN=https://benday.qex.at pnpm build
```

The default public origin is <https://benday.qex.at>. To host elsewhere, set
`BENDAY_PUBLIC_ORIGIN` to the new HTTPS origin and rebuild. Upload the **contents
of `dist/`, including `.htaccess`**, to the origin's web root. Apache must allow
the included directory overrides; other servers need equivalent static-file
serving and single-page-app routing.

Public sign-in requires working DNS and a valid HTTPS certificate. Serve
`/oauth-client-metadata.json` from the same build as the app: it must return
`200` directly as `application/json`, without a redirect or authentication gate.
Serve existing files before falling back to `index.html` for client routes,
including the `/feed` sign-in callback, preserving query strings.

After publishing, check the metadata response, direct navigation to `/feed`,
sign-in and session restoration on the public origin. A local build does not
verify hosting configuration.
