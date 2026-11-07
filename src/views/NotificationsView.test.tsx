import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { notificationsQueryKey } from '../hooks/useNotifications'
import { useAuthStore } from '../lib/auth'
import type { NotificationModel } from '../lib/notifications'
import { postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { installTransport, jsonResponse, type TestTransport } from '../test/transport'
import NotificationsView from './NotificationsView'

const PDS = 'https://pds.test'
const VIEWER_DID = 'did:plc:alice'
const REPLY_URI = 'at://did:plc:author/app.bsky.feed.post/reply'
const PARENT_URI = 'at://did:plc:alice/app.bsky.feed.post/parent'
const LIKE_TARGET = 'at://did:plc:test/app.bsky.feed.post/1'

const SESSION = {
  did: VIEWER_DID,
  handle: 'alice.test',
  accessJwt: 'alice-access',
  refreshJwt: 'alice-refresh',
  active: true,
}

let transport: TestTransport

function notification(
  id: string,
  author: { handle: string; displayName: string },
  overrides: Partial<NotificationModel> = {},
): NotificationModel {
  return {
    id,
    uri: `at://did:plc:test/app.bsky.feed.like/${id}`,
    reason: 'like',
    author: {
      did: `did:plc:${id}`,
      handle: author.handle,
      displayName: author.displayName,
      avatar: null,
      muted: false,
      blocked: false,
    },
    subject: LIKE_TARGET,
    subjectText: 'hey',
    subjectPost: null,
    isRead: true,
    indexedAt: '2026-10-29T12:00:00.000Z',
    ...overrides,
  }
}

const ROWS: NotificationModel[] = [
  notification('rocket', { handle: 'rocket.test', displayName: '🚀 rocketeer' }),
  notification('lower', { handle: 'mixed.test', displayName: '' }),
  notification('ghost', { handle: '', displayName: '' }),
]

const REPLY: NotificationModel = notification(
  'reply',
  { handle: 'author.test', displayName: 'reply author' },
  {
    reason: 'reply',
    uri: REPLY_URI,
    subject: PARENT_URI,
    subjectText: 'the reply body',
    isRead: false,
  },
)

/**
 * Seeds the query cache directly so the deck is populated on the first paint.
 * Pass `null` to leave the cache empty and let the real transport serve (or
 * fail) the first page.
 */
function renderNotifications(
  rows: NotificationModel[] | null = ROWS,
  seenAt: string | null = null,
) {
  const queryClient = createTestQueryClient()
  if (rows !== null) {
    queryClient.setQueryData(notificationsQueryKey(VIEWER_DID), {
      notifications: rows,
      newestIndexedAt: seenAt,
    })
  }
  const memory = memoryLocation({ path: '/notifications', record: true })
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <NotificationsView />
      </Router>
    </QueryClientProvider>,
  )
  return memory
}

function avatarGlyphs(): string[] {
  return Array.from(document.querySelectorAll('.b-notif__avatar .dither-image--fallback')).map(
    (glyph) => glyph.textContent ?? '',
  )
}

function threadHref(uri: string): string {
  return `/thread?uri=${encodeURIComponent(uri)}`
}

async function notificationDeck(): Promise<HTMLElement> {
  const deck = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('.b-deck')
    if (found === null) throw new Error('notification deck not rendered')
    return found
  })
  return deck
}

function focusedIndex(): number | null {
  const raw = document
    .querySelector('.b-deck__item[data-focused="true"]')
    ?.getAttribute('data-deck-index')
  return raw === null || raw === undefined ? null : Number(raw)
}

/** The deck is wide on wide screens, so the axis decides which keys travel. */
function travelKeys(deck: HTMLElement): { forward: string; back: string } {
  return deck.dataset['axis'] === 'x'
    ? { forward: 'ArrowRight', back: 'ArrowLeft' }
    : { forward: 'ArrowDown', back: 'ArrowUp' }
}

function seenBodies(): unknown[] {
  return transport.calls
    .filter((call) => call.url.includes('app.bsky.notification.updateSeen'))
    .map((call) => JSON.parse(call.body ?? '{}'))
}

beforeEach(async () => {
  transport = installTransport()
  transport.route('POST', `${PDS}/xrpc/com.atproto.server.createSession`, () =>
    jsonResponse(200, SESSION),
  )
  transport.route('GET', `https://plc.directory/${VIEWER_DID}`, () =>
    jsonResponse(200, {
      id: VIEWER_DID,
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
    }),
  )
  const ok = await useAuthStore.getState().signIn(VIEWER_DID, 'app-pass')
  expect(ok).toBe(true)
})

describe('NotificationsView avatars', () => {
  it('keeps a whole leading emoji and the handle case, and never injects @', async () => {
    renderNotifications()

    await screen.findByText('🚀 rocketeer')
    expect(avatarGlyphs()).toEqual(['🚀', 'm', 'u'])

    // the fallback name comes from the raw handle, not the `@handle` display helper
    expect(screen.getAllByText('@mixed.test').length).toBeGreaterThan(0)
  })
})

describe('NotificationsView cards', () => {
  it('renders one deck card per notification', async () => {
    renderNotifications()

    await screen.findByText('🚀 rocketeer')

    const deck = await notificationDeck()
    // the shared deck exposes the axis it drives its arrows on
    expect(deck.dataset['axis'] === 'x' || deck.dataset['axis'] === 'y').toBe(true)
    expect(deck.querySelectorAll('.b-deck__item')).toHaveLength(3)
    expect(deck.querySelectorAll('.b-deck__item > .b-notif')).toHaveLength(3)
  })

  it('renders each card as a frame card with a head, body and footer', async () => {
    renderNotifications([REPLY])

    const row = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.b-notif')
      if (found === null) throw new Error('card not rendered')
      return found
    })

    expect(row.tagName).toBe('ARTICLE')
    expect(row.closest('.b-deck__item')).not.toBeNull()
    expect(row.classList.contains('b-frame')).toBe(true)
    expect(row.querySelector('.b-frame__head .b-frame__label')?.textContent).toBe(
      'replied to your post',
    )
    expect(row.querySelector('.b-frame__body .b-notif__avatar')).not.toBeNull()
    expect(row.querySelector('.b-frame__body .b-notif__subject')).not.toBeNull()
    expect(row.querySelector('footer.b-notif__foot .b-notif__open')).not.toBeNull()
    expect(row.querySelector('.b-notif__time')).not.toBeNull()
  })

  it('shows the post a notification points at with its counts', async () => {
    const likedPost = postFixture({
      uri: LIKE_TARGET,
      text: 'the post they liked',
      likeCount: 7,
      replyCount: 2,
      repostCount: 1,
    })
    renderNotifications([
      notification(
        'context',
        { handle: 'fan.test', displayName: 'fan' },
        { reason: 'like', subjectPost: likedPost },
      ),
    ])

    const context = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.b-notif__context')
      if (found === null) throw new Error('context not rendered')
      return found
    })
    expect(context.querySelector('.b-notif__context-text')?.textContent).toBe('the post they liked')
    expect(context.querySelector('.b-notif__context-author')?.textContent).toMatch(/^@/)
    // the post's own weight sits with the subject it describes, not on the foot
    const stats = document.querySelector('.b-notif__context-stats')
    expect(stats?.textContent).toBe('2 replies · 7 likes · 1 repost')
    expect(context.contains(stats)).toBe(true)
    expect(document.querySelector('.b-notif__foot .b-notif__context-stats')).toBeNull()
    expect(document.querySelector('.b-notif__foot-stats')).toBeNull()
    // the context block points at the same thread as the card's open link
    expect(context.getAttribute('href')).toContain('/thread?uri=')
  })

  it('opens the parent from a reply card context and the reply from its footer', async () => {
    const parent = postFixture({ uri: PARENT_URI, text: 'the post that was answered' })
    renderNotifications([{ ...REPLY, subjectPost: parent }])

    const context = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.b-notif__context')
      if (found === null) throw new Error('context not rendered')
      return found
    })
    const footer = document.querySelector<HTMLElement>('.b-notif__open')
    if (footer === null) throw new Error('footer link missing')
    expect(context.getAttribute('href')).toBe(`/thread?uri=${encodeURIComponent(PARENT_URI)}`)
    expect(footer.getAttribute('href')).toBe(`/thread?uri=${encodeURIComponent(REPLY_URI)}`)
  })

  it('opens the notification from body text once, on the reply target', async () => {
    const memory = renderNotifications([REPLY])
    await screen.findByText('reply author')
    const bodyText = document.querySelector<HTMLElement>('.b-notif__handle')
    if (bodyText === null) throw new Error('body handle not rendered')
    expect(bodyText.closest('.b-notif')?.getAttribute('data-clickable')).toBe('true')
    const before = memory.history.length

    fireEvent.click(bodyText)

    await waitFor(() => expect(memory.history.at(-1)).toBe(threadHref(REPLY_URI)))
    // the row handler is the only owner: the profile link and footer keep their
    // own destinations and never fire together with it
    expect(memory.history.length).toBe(before + 1)
  })

  it('lets a context link open its own thread without the row firing too', async () => {
    const parent = postFixture({ uri: PARENT_URI, text: 'the post that was answered' })
    const memory = renderNotifications([{ ...REPLY, subjectPost: parent }])
    await screen.findByText('reply author')
    const contextText = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.b-notif__context-text')
      if (found === null) throw new Error('context text not rendered')
      return found
    })
    const before = memory.history.length

    fireEvent.click(contextText)

    await waitFor(() =>
      expect(memory.history.at(-1)).toBe(`/thread?uri=${encodeURIComponent(PARENT_URI)}`),
    )
    expect(memory.history).not.toContain(threadHref(REPLY_URI))
    expect(memory.history.length).toBe(before + 1)
  })

  it('keeps the header free of counts and refresh controls', async () => {
    renderNotifications()

    await screen.findByText('🚀 rocketeer')

    expect(document.querySelector('.b-notif__count')).toBeNull()
    expect(screen.queryByRole('button', { name: 'refresh' })).toBeNull()
  })

  it('shows the empty state without a refresh action', async () => {
    renderNotifications([])

    await screen.findByText('nothing yet')
    expect(screen.queryByRole('button', { name: 'refresh' })).toBeNull()
    expect(screen.getByText('when people follow, like or reply to you it shows up here.'))
  })

  it('lets user prose choose its own direction', async () => {
    const parent = postFixture({ uri: PARENT_URI, text: 'שלום עולם' })
    renderNotifications([{ ...REPLY, subjectPost: parent, subjectText: 'שלום' }])

    await screen.findByText('reply author')

    expect(document.querySelector('.b-notif__context-text')?.getAttribute('dir')).toBe('auto')
    expect(document.querySelector('.b-notif__subject')?.getAttribute('dir')).toBe('auto')
    // the statistics and the author handle are not prose: they keep the page
    // direction instead of guessing
    expect(document.querySelector('.b-notif__context-stats')?.getAttribute('dir')).toBeNull()
  })

  it('cuts a long preview on a whole cluster and marks the cut', async () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}'
    const text = `${'a'.repeat(219)}${family}tail`
    const parent = postFixture({ uri: PARENT_URI, text })
    renderNotifications([{ ...REPLY, subjectPost: parent }])

    await screen.findByText('reply author')
    const preview = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.b-notif__context-text')
      if (found === null) throw new Error('context text not rendered')
      return found
    })

    // 219 plain clusters plus one four-person cluster is exactly the 220 limit,
    // so the family emoji survives whole and the cut is visible
    expect(preview.textContent).toBe(`${'a'.repeat(219)}${family}…`)
    expect(preview.textContent?.includes(`\u200D…`)).toBe(false)
  })

  it('falls back to the unknown actor when a follow has no handle', async () => {
    const follow = notification(
      'anon',
      { handle: '', displayName: '' },
      { reason: 'follow', subject: null, subjectText: null },
    )
    const memory = renderNotifications([follow])

    const card = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.b-notif')
      if (found === null) throw new Error('card not rendered')
      return found
    })
    expect(card.querySelector('.b-notif__handle')?.textContent).toBe('@unknown')
    expect(card.querySelector('.b-notif__name')?.textContent).toBe('@unknown')
    const open = card.querySelector<HTMLElement>('.b-notif__open')
    if (open === null) throw new Error('open link missing')
    expect(open.getAttribute('href')).toBe('/profile/unknown')
    expect(open.textContent).toContain('open profile')

    fireEvent.click(open)
    await waitFor(() => expect(memory.history.at(-1)).toBe('/profile/unknown'))
  })

  it('marks an unread card', async () => {
    renderNotifications([REPLY])

    const row = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.b-notif')
      if (found === null) throw new Error('card not rendered')
      return found
    })

    expect(row).toHaveAttribute('data-unread', 'true')
    expect(row.querySelector('.b-notif__unread')?.textContent).toBe('unread')
  })
})

describe('NotificationsView deck navigation', () => {
  it('moves the deck focus exactly once per arrow press', async () => {
    renderNotifications()
    await screen.findByText('🚀 rocketeer')
    const deck = await notificationDeck()
    const keys = travelKeys(deck)

    fireEvent.keyDown(window, { key: 'g' })
    await waitFor(() => expect(focusedIndex()).toBe(0))

    fireEvent.keyDown(window, { key: keys.forward })
    await waitFor(() => expect(focusedIndex()).toBe(1))

    // one press is one card, not a skip
    fireEvent.keyDown(window, { key: keys.forward })
    await waitFor(() => expect(focusedIndex()).toBe(2))

    fireEvent.keyDown(window, { key: keys.back })
    await waitFor(() => expect(focusedIndex()).toBe(1))

    // leaving the first card backwards is a no-op here: there is no surface
    // above the notifications list for the deck to exit to
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: keys.back })
    await waitFor(() => expect(focusedIndex()).toBe(0))
  })

  it('focuses a card by position with the number keys', async () => {
    renderNotifications()
    await screen.findByText('🚀 rocketeer')
    const deck = await notificationDeck()
    deck.focus()

    fireEvent.keyDown(deck, { key: '3' })
    await waitFor(() => expect(focusedIndex()).toBe(2))

    fireEvent.keyDown(deck, { key: '1' })
    await waitFor(() => expect(focusedIndex()).toBe(0))
  })

  it('jumps to the ends with g and G', async () => {
    renderNotifications()
    await screen.findByText('🚀 rocketeer')
    await notificationDeck()

    fireEvent.keyDown(window, { key: 'G' })
    await waitFor(() => expect(focusedIndex()).toBe(2))

    fireEvent.keyDown(window, { key: 'g' })
    await waitFor(() => expect(focusedIndex()).toBe(0))
  })

  it('opens the focused notification on enter, once', async () => {
    const memory = renderNotifications()
    await screen.findByText('🚀 rocketeer')
    const deck = await notificationDeck()

    deck.focus()
    fireEvent.keyDown(window, { key: 'g' })
    const before = memory.history.length

    fireEvent.keyDown(deck, { key: 'Enter' })

    await waitFor(() => expect(memory.history.at(-1)).toBe(threadHref(LIKE_TARGET)))
    // the deck is the only keyboard owner, so no leftover row handler adds a
    // second navigation on the same press
    expect(memory.history.length).toBe(before + 1)
  })

  it('leaves a link inside a card to navigate to its own target', async () => {
    const memory = renderNotifications([REPLY])
    await screen.findByText('reply author')
    await notificationDeck()

    const before = memory.history.length
    fireEvent.click(screen.getByRole('link', { name: 'reply author' }))

    await waitFor(() => expect(memory.history.at(-1)).toBe('/profile/author.test'))
    expect(memory.history.length).toBe(before + 1)

    fireEvent.click(screen.getByRole('link', { name: /open thread/ }))
    await waitFor(() => expect(memory.history.at(-1)).toBe(threadHref(REPLY_URI)))
    expect(memory.history).not.toContain(threadHref(PARENT_URI))
  })
})

describe('NotificationsView states', () => {
  it('still advances the seen cursor for the page it renders', async () => {
    transport.route('POST', `${PDS}/xrpc/app.bsky.notification.updateSeen`, () =>
      jsonResponse(200, {}),
    )
    renderNotifications(ROWS, '2026-10-29T12:00:00.000Z')
    await screen.findByText('🚀 rocketeer')

    await waitFor(() => expect(seenBodies()).toEqual([{ seenAt: '2026-10-29T12:00:00.000Z' }]))
  })

  it('shows the load failure with a retry when the first page fails', async () => {
    transport.route('GET', `${PDS}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'nope' }),
    )
    renderNotifications(null)

    await screen.findByText('internal server error', undefined, { timeout: 3000 })
    expect(screen.getByRole('alert')).toHaveTextContent('nope')
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument()
    expect(document.querySelector('.b-deck')).toBeNull()
  })

  it('refetches the page and renders the rows when the failed load is retried', async () => {
    const list = `${PDS}/xrpc/app.bsky.notification.listNotifications`
    transport.route('GET', list, () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'nope' }),
    )
    renderNotifications(null)

    await screen.findByText('internal server error', undefined, { timeout: 3000 })
    const listRequest = '/xrpc/app.bsky.notification.listNotifications'
    const before = transport.calls.filter((call) => call.url.includes(listRequest)).length
    expect(before).toBeGreaterThan(0)

    transport.route('GET', list, () =>
      jsonResponse(200, {
        notifications: [
          {
            uri: 'at://did:plc:fan/app.bsky.graph.follow/1',
            cid: 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm',
            author: { did: 'did:plc:fan', handle: 'fan.test' },
            reason: 'follow',
            record: {
              $type: 'app.bsky.graph.follow',
              subject: VIEWER_DID,
              createdAt: '2026-10-29T12:00:00.000Z',
            },
            isRead: true,
            indexedAt: '2026-10-29T12:00:00.000Z',
          },
        ],
      }),
    )
    transport.route('POST', `${PDS}/xrpc/app.bsky.notification.updateSeen`, () =>
      jsonResponse(200, {}),
    )

    fireEvent.click(screen.getByRole('button', { name: 'retry' }))

    await waitFor(() => expect(document.querySelectorAll('.b-deck__item')).toHaveLength(1))
    // the click really asked the server again instead of reusing a cached error
    expect(transport.calls.filter((call) => call.url.includes(listRequest)).length).toBe(before + 1)
    expect(screen.getByText('followed you')).toBeInTheDocument()
  })
})
