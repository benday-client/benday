import { QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { useAuthStore } from '../lib/auth'
import type { ComposeRequest } from '../lib/ui'
import { useUiStore } from '../lib/ui'
import { postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { renderStage } from '../test/stage'
import { installTransport, jsonResponse, type TestTransport } from '../test/transport'
import { ComposeDialog } from './ComposeDialog'
import { InlineComposer } from './InlineComposer'

const PDS = 'https://pds.test'
// the lexicons cap a display name at 64 graphemes; these still wrap onto
// several lines inside a narrow dock, which is what makes six rows overflow
const WRAPPED_NAMES = [
  'display name one that wraps over several lines in the dock',
  'display name two that wraps over several lines in the dock',
  'display name three wraps over several lines in the dock',
  'display name four wraps over several lines in the dock',
  'display name five wraps over several lines in the dock',
  'display name six wraps over several lines in the dock',
]

const ALICE = {
  did: 'did:plc:alice',
  handle: 'alice.test',
  accessJwt: 'alice-access',
  refreshJwt: 'alice-refresh',
  active: true,
}

// a lex-valid cid: the createRecord output parser rejects arbitrary strings
const POST_CID = 'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a'

const ACTORS = WRAPPED_NAMES.map((displayName, index) => ({
  did: `did:plc:actor${index}`,
  handle: `actor-${index}.test`,
  displayName,
}))

function renderDock(request: ComposeRequest, transport: TestTransport = installTransport()) {
  const client = createTestQueryClient()
  const onClose = vi.fn()
  useUiStore.setState({ inlineCompose: request, compose: null })
  const view = renderStage(
    <QueryClientProvider client={client}>
      <div
        data-testid="thread-scroller"
        style={{ width: '360px', height: '260px', overflow: 'auto' }}
      >
        <InlineComposer request={request} onClose={onClose} />
        <div style={{ height: '600px' }} aria-hidden="true" />
      </div>
    </QueryClientProvider>,
  )
  const dock = document.querySelector<HTMLElement>('.b-compose-dock')
  const input = document.querySelector<HTMLTextAreaElement>('.b-compose__input')
  if (dock === null || input === null) throw new Error('missing compose dock')
  return { transport, client, onClose, view, dock, input }
}

async function signIn(transport: TestTransport): Promise<void> {
  transport.route('POST', `${PDS}/xrpc/com.atproto.server.createSession`, () =>
    jsonResponse(200, ALICE),
  )
  transport.route('POST', `${PDS}/xrpc/com.atproto.server.deleteSession`, () =>
    jsonResponse(200, {}),
  )
  expect(await useAuthStore.getState().signIn(ALICE.handle, 'password', PDS)).toBe(true)
}

/** Types the mention prefix and waits until the settled typeahead paints. */
async function openSixWrappedOptions(input: HTMLTextAreaElement): Promise<void> {
  await document.fonts.ready
  input.focus()
  await userEvent.type(input, '@a')
  await waitFor(
    () => {
      expect(document.querySelectorAll('.b-compose__suggestion').length).toBe(ACTORS.length)
    },
    { timeout: 4000 },
  )
}

afterEach(async () => {
  await useAuthStore.getState().signOut()
})

describe('compose suggestion list', () => {
  it('scrolls only the list and keeps the active option visible', async () => {
    await page.viewport(1280, 380)
    const transport = installTransport()
    transport.route('GET', 'https://api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead', () =>
      jsonResponse(200, { actors: ACTORS }),
    )
    const { dock, input } = renderDock({ mode: 'reply', post: postFixture() }, transport)
    await openSixWrappedOptions(input)

    const list = dock.querySelector<HTMLElement>('.b-compose__suggestions')
    const scroller = document.querySelector<HTMLElement>('[data-testid="thread-scroller"]')
    if (list === null || scroller === null) throw new Error('missing scroll surfaces')

    const before = {
      list: list.scrollTop,
      dock: dock.scrollTop,
      scroller: scroller.scrollTop,
    }
    expect(before.list).toBe(0)

    for (let step = 0; step < ACTORS.length - 1; step += 1) {
      await userEvent.keyboard('{ArrowDown}')
    }

    const activeId = input.getAttribute('aria-activedescendant')
    const active = activeId === null ? null : document.getElementById(activeId)
    if (active === null) throw new Error('missing active option')
    expect(active.getAttribute('aria-selected')).toBe('true')

    // the list moved to reveal the last row, and nothing else scrolled with it
    await waitFor(() => expect(list.scrollTop).toBeGreaterThan(0))
    expect(dock.scrollTop).toBe(before.dock)
    expect(scroller.scrollTop).toBe(before.scroller)

    const box = list.getBoundingClientRect()
    const row = active.getBoundingClientRect()
    expect(row.top).toBeGreaterThanOrEqual(box.top - 1)
    expect(row.bottom).toBeLessThanOrEqual(box.bottom + 1)

    // the sticky actions row is still inside the dock after the list moved
    const actions = dock.querySelector<HTMLElement>('.b-compose__actions')
    if (actions === null) throw new Error('missing compose actions')
    const dockBox = dock.getBoundingClientRect()
    const actionsBox = actions.getBoundingClientRect()
    expect(actionsBox.top).toBeGreaterThanOrEqual(dockBox.top - 1)
    expect(actionsBox.bottom).toBeLessThanOrEqual(dockBox.bottom + 1)
  })

  it('prints the shared send hint in both composer surfaces', async () => {
    const { view } = renderDock({ mode: 'reply', post: postFixture() })
    const dockHint = document.querySelector('.b-compose__hint')
    expect(dockHint?.textContent).toBe('ctrl/cmd enter send')
    view.unmount()

    const client = createTestQueryClient()
    render(
      <QueryClientProvider client={client}>
        <ComposeDialog
          open
          request={{ mode: 'reply', post: postFixture() }}
          onClose={() => undefined}
        />
      </QueryClientProvider>,
    )
    const dialog = document.querySelector<HTMLDialogElement>('dialog')
    if (dialog === null) throw new Error('missing compose dialog')
    expect(dialog.querySelector('.b-compose__hint')?.textContent).toBe('ctrl/cmd enter send')
  })
})

describe('pending read-only editor', () => {
  it('keeps native text selection while the send is in flight', async () => {
    await page.viewport(1280, 800)
    const transport = installTransport()
    await signIn(transport)
    const gate = Promise.withResolvers<Response>()
    transport.route('POST', `${PDS}/xrpc/com.atproto.repo.createRecord`, () => gate.promise)

    try {
      const { onClose, dock, input } = renderDock({ mode: 'reply', post: postFixture() }, transport)
      await document.fonts.ready
      input.focus()
      await userEvent.type(input, 'hello world')

      await userEvent.keyboard('{Control>}{Enter}{/Control}')
      await waitFor(() => expect(input.readOnly).toBe(true))
      expect(input.disabled).toBe(false)
      expect(document.activeElement).toBe(input)
      expect(dock.scrollTop).toBe(0)

      input.setSelectionRange(0, 5)
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(5)

      // a read-only textarea still lets the selection survive a keystroke
      await userEvent.keyboard('X')
      expect(input.value).toBe('hello world')
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(5)

      gate.resolve(
        jsonResponse(200, {
          uri: 'at://did:plc:alice/app.bsky.feed.post/1',
          cid: POST_CID,
        }),
      )
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    } finally {
      await useAuthStore.getState().signOut()
    }
  })
})
