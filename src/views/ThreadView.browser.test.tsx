import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useSettings } from '../lib/store'
import type { PostModel, ThreadModel } from '../lib/types'
import { useUiStore } from '../lib/ui'
import { resolveSrgbColor } from '../test/colors'
import { longPostFixture, postFixture, threadFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { renderStage } from '../test/stage'
import ThreadView from './ThreadView'

const APPVIEW = 'https://api.bsky.app'
const ROOT_URI = 'at://did:plc:test/app.bsky.feed.post/root'
const REPLY_URI = 'at://did:plc:test/app.bsky.feed.post/reply'

async function settle(): Promise<void> {
  await new Promise<void>((done) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        done()
      })
    })
  })
}

interface ThreadRender {
  history: string[]
  container: HTMLElement
}

function renderThread(model: ThreadModel, seeds: ThreadModel[] = []): ThreadRender {
  const queryClient = createTestQueryClient()
  // seed the route's own thread plus any thread a key is about to open, so
  // navigation never reaches for the network
  for (const entry of [model, ...seeds]) {
    const key = ['thread', APPVIEW, 'anonymous', entry.focusUri]
    queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY })
    queryClient.setQueryData(key, entry)
  }
  const memory = memoryLocation({
    path: '/thread',
    searchPath: `uri=${encodeURIComponent(model.focusUri)}`,
    record: true,
  })
  const result = renderStage(
    <QueryClientProvider client={queryClient}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <ThreadView />
      </Router>
    </QueryClientProvider>,
  )
  return { history: memory.history, container: result.container }
}

function outerScroller(container: HTMLElement): HTMLElement {
  const body = container.querySelector<HTMLElement>('.b-view__body--thread')
  if (body === null) throw new Error('thread body missing')
  return body
}

function cardOf(container: HTMLElement): HTMLElement {
  const card = container.querySelector<HTMLElement>('.b-thread > .b-post-card')
  if (card === null) throw new Error('thread card missing')
  return card
}

function cardBody(container: HTMLElement): HTMLElement {
  const body = container.querySelector<HTMLElement>('.b-thread > .b-post-card .b-post-card__body')
  if (body === null) throw new Error('card body missing')
  return body
}

function actionsOf(container: HTMLElement): HTMLElement {
  const actions = container.querySelector<HTMLElement>(
    '.b-thread > .b-post-card .b-post-card__actions',
  )
  if (actions === null) throw new Error('card actions missing')
  return actions
}

interface SelectionSnapshot {
  text: string
  start: number
  end: number
}

function selectionSnapshot(): SelectionSnapshot | null {
  const selection = document.getSelection()
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  return { text: selection.toString(), start: range.startOffset, end: range.endOffset }
}

/** Selects a known nonempty run of the card text and proves it really is selected. */
function selectCardText(container: HTMLElement): SelectionSnapshot {
  const block = container.querySelector('.b-thread > .b-post-card .b-post-card__text')
  if (block === null) throw new Error('post text missing')
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let target: Text | null = null
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node instanceof Text && node.data.trim().length > 0) {
      target = node
      break
    }
  }
  if (target === null) throw new Error('no selectable text')
  const range = document.createRange()
  range.setStart(target, 0)
  range.setEnd(target, Math.min(5, target.data.length))
  const selection = document.getSelection()
  if (selection === null) throw new Error('selection unavailable')
  selection.removeAllRanges()
  selection.addRange(range)
  const snapshot = selectionSnapshot()
  if (snapshot === null || snapshot.text.length === 0) throw new Error('selection is empty')
  return snapshot
}

function keyProbe() {
  let prevented = false
  const probe = (event: KeyboardEvent) => {
    prevented = event.defaultPrevented
  }
  window.addEventListener('keydown', probe)
  return {
    consumed: () => prevented,
    stop: () => {
      window.removeEventListener('keydown', probe)
    },
  }
}

function nestedThread(): ThreadModel {
  const focus = postFixture({ uri: ROOT_URI, text: 'root post' })
  const reply = postFixture({ uri: REPLY_URI, text: 'a reply', isReply: true })
  const nested = postFixture({
    uri: 'at://did:plc:test/app.bsky.feed.post/nested',
    text: 'a nested reply',
    isReply: true,
  })
  return {
    focusUri: focus.uri,
    entries: [
      { post: focus, depth: 0, role: 'focus' },
      { post: reply, depth: 1, role: 'reply' },
      { post: nested, depth: 2, role: 'reply' },
    ],
  }
}

function rootThread(long: boolean): ThreadModel {
  const focus = long
    ? longPostFixture({ uri: ROOT_URI })
    : postFixture({ uri: ROOT_URI, text: 'short root post' })
  return threadFixture(focus, [postFixture({ uri: REPLY_URI, text: 'a reply', isReply: true })])
}

function parentedThread(): PostModel {
  return longPostFixture({
    uri: ROOT_URI,
    isReply: true,
    replyParent: { uri: 'at://did:plc:test/app.bsky.feed.post/parent', cid: 'cid-parent' },
  })
}

beforeEach(async () => {
  await page.viewport(1280, 800)
  useUiStore.setState({ dialog: null, compose: null, inlineCompose: null, openingPost: null })
})

describe('ThreadView root layout', () => {
  it('ends a short root card above the container bottom with its actions in view', async () => {
    const { container } = renderThread(rootThread(false))
    await settle()

    const card = cardOf(container)
    const scroller = outerScroller(container)
    expect(card.closest('.b-thread')?.classList.contains('b-thread--stack')).toBe(false)

    const cardRect = card.getBoundingClientRect()
    const bodyRect = scroller.getBoundingClientRect()
    expect(cardRect.height).toBeGreaterThan(0)
    expect(cardRect.bottom).toBeLessThan(bodyRect.bottom - 20)

    const actions = actionsOf(container).getBoundingClientRect()
    expect(actions.bottom).toBeLessThanOrEqual(cardRect.bottom + 1)
    expect(actions.bottom).toBeLessThan(bodyRect.bottom)
    expect(actions.top).toBeGreaterThanOrEqual(bodyRect.top)

    // a content-sized card never scrolls its own body
    const inner = cardBody(container)
    expect(inner.scrollHeight).toBeLessThanOrEqual(inner.clientHeight + 1)
    expect(scroller.scrollHeight).toBeLessThanOrEqual(scroller.clientHeight + 1)
  })

  it('scrolls a long root card through the outer body until its actions are visible', async () => {
    const { container } = renderThread(rootThread(true))
    await settle()

    const card = cardOf(container)
    const scroller = outerScroller(container)
    const inner = cardBody(container)
    expect(card.getBoundingClientRect().height).toBeGreaterThan(
      scroller.getBoundingClientRect().height,
    )
    expect(inner.scrollHeight).toBeLessThanOrEqual(inner.clientHeight + 1)
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight + 100)

    scroller.scrollTop = scroller.scrollHeight
    await settle()
    const scrollerRect = scroller.getBoundingClientRect()
    const actions = actionsOf(container).getBoundingClientRect()
    expect(actions.bottom).toBeLessThanOrEqual(scrollerRect.bottom + 1)
    expect(actions.top).toBeGreaterThanOrEqual(scrollerRect.top - 1)
    expect(inner.scrollTop).toBe(0)
  })
})

describe('ThreadView parented layout', () => {
  it('caps the card and scrolls its own body', async () => {
    const { container } = renderThread(threadFixture(parentedThread(), []))
    await settle()

    const card = cardOf(container)
    const scroller = outerScroller(container)
    expect(card.closest('.b-thread')?.classList.contains('b-thread--stack')).toBe(true)

    const cardRect = card.getBoundingClientRect()
    expect(cardRect.height).toBeLessThanOrEqual(scroller.getBoundingClientRect().height + 1)

    const inner = cardBody(container)
    inner.scrollTop = inner.scrollHeight
    await settle()
    expect(inner.scrollTop).toBeGreaterThan(0)
    expect(inner.scrollTop).toBeLessThanOrEqual(inner.scrollHeight - inner.clientHeight + 1)

    const actions = actionsOf(container).getBoundingClientRect()
    expect(actions.bottom).toBeLessThanOrEqual(cardRect.bottom + 1)
    expect(actions.top).toBeGreaterThanOrEqual(cardRect.top - 1)
  })
})

describe('ThreadView body keys at a constrained viewport', () => {
  it('scrolls the capped card body with PageDown before the page', async () => {
    await page.viewport(390, 600)
    const { container, history } = renderThread(threadFixture(parentedThread(), []))
    await settle()

    const inner = cardBody(container)
    expect(inner.scrollHeight).toBeGreaterThan(inner.clientHeight + 1)

    inner.scrollTop = 0
    const historyLength = history.length
    const probe = keyProbe()
    await userEvent.keyboard('{PageDown}')
    probe.stop()
    await settle()

    expect(probe.consumed()).toBe(true)
    expect(inner.scrollTop).toBeGreaterThan(0)
    expect(inner.scrollTop).toBeLessThanOrEqual(inner.scrollHeight - inner.clientHeight + 1)
    expect(history.length).toBe(historyLength)
  })
})

describe('ThreadView page keys', () => {
  it('preserves the selected page text at every scroll position', async () => {
    const { container, history } = renderThread(rootThread(true))
    await settle()
    const scroller = outerScroller(container)
    const inner = cardBody(container)
    const before = selectCardText(container)
    const historyLength = history.length

    // top edge: nothing can move, the key is still consumed
    scroller.scrollTop = 0
    const topProbe = keyProbe()
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}')
    topProbe.stop()
    expect(topProbe.consumed()).toBe(true)
    expect(scroller.scrollTop).toBe(0)
    expect(selectionSnapshot()).toEqual(before)

    // mid body: the outer page moves and the selection survives
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(scroller.scrollTop).toBeGreaterThan(0)
    expect(selectionSnapshot()).toEqual(before)

    // bottom edge: consumed without moving
    scroller.scrollTop = scroller.scrollHeight
    const bottom = scroller.scrollTop
    const bottomProbe = keyProbe()
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}')
    bottomProbe.stop()
    expect(bottomProbe.consumed()).toBe(true)
    expect(scroller.scrollTop).toBe(bottom)
    expect(selectionSnapshot()).toEqual(before)

    // the leg-sized card body never scrolled instead of the page
    expect(inner.scrollTop).toBe(0)
    expect(history.length).toBe(historyLength)
  })

  it('moves the outer body on PageDown instead of the content-sized card body', async () => {
    const { container, history } = renderThread(rootThread(true))
    await settle()
    const scroller = outerScroller(container)
    const inner = cardBody(container)
    scroller.scrollTop = 0
    const historyLength = history.length

    const probe = keyProbe()
    await userEvent.keyboard('{PageDown}')
    probe.stop()
    await settle()

    expect(probe.consumed()).toBe(true)
    expect(scroller.scrollTop).toBeGreaterThan(0)
    expect(inner.scrollTop).toBe(0)
    expect(history.length).toBe(historyLength)
  })
})

describe('ThreadView tree keys', () => {
  const PARENT_URI = 'at://did:plc:test/app.bsky.feed.post/parent'

  beforeEach(() => {
    // the k alias is a character shortcut; the stored preference is shared
    // with other browser specs through localStorage
    useSettings.setState({ keyboardShortcuts: true })
  })

  it('moves down into children and up to the parent reply', async () => {
    const { container } = renderThread(nestedThread())
    await settle()
    const replies = Array.from(container.querySelectorAll<HTMLElement>('.b-thread__reply'))
    const [first, nested] = replies
    if (first === undefined || nested === undefined) throw new Error('missing replies')

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(first)

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(nested)

    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(first)

    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(container.querySelector('.b-thread'))
  })

  it('opens the parent thread with ArrowUp at a parented focus post', async () => {
    const parentModel = threadFixture(postFixture({ uri: PARENT_URI, text: 'parent post' }), [])
    const { history } = renderThread(threadFixture(parentedThread(), []), [parentModel])
    await settle()
    const before = history.length

    await userEvent.keyboard('{ArrowUp}')
    await settle()

    expect(history).toHaveLength(before + 1)
    expect(history.at(-1)).toBe(`/thread?uri=${encodeURIComponent(PARENT_URI)}`)
  })

  it('leaves a root thread with left instead of opening a parent', async () => {
    window.history.replaceState(null, '')
    const { history } = renderThread(rootThread(false))
    await settle()

    await userEvent.keyboard('{ArrowLeft}')
    await settle()

    expect(history.at(-1)).toBe('/feed')
  })
})

describe('ThreadView inline reply', () => {
  it('extends a native editor selection without moving the page', async () => {
    const model = rootThread(false)
    const { container } = renderThread(model)
    await settle()

    const focusPost = model.entries[0]?.post
    if (focusPost === undefined) throw new Error('focus post missing')
    act(() => {
      useUiStore.setState({
        inlineCompose: { mode: 'reply', post: focusPost },
      })
    })
    await settle()

    expect(screen.getByLabelText('reply composer')).toBeInTheDocument()
    const editor = screen.getByLabelText('compose reply')
    if (!(editor instanceof HTMLTextAreaElement)) throw new Error('compose editor missing')
    expect(document.activeElement).toBe(editor)

    await userEvent.type(editor, 'abcdef')
    editor.setSelectionRange(0, 2)
    const scroller = outerScroller(container)
    const inner = cardBody(container)
    const offsets = { outer: scroller.scrollTop, inner: inner.scrollTop }

    const probe = keyProbe()
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    probe.stop()

    expect(probe.consumed()).toBe(false)
    expect(editor.selectionStart).toBe(0)
    expect(editor.selectionEnd).toBe(3)
    expect({ outer: scroller.scrollTop, inner: inner.scrollTop }).toEqual(offsets)
    expect(screen.getByLabelText('reply composer')).toBeInTheDocument()
  })

  it('draws an indent rail only on a nested reply', async () => {
    renderThread(nestedThread())
    await settle()
    const rows = [...document.querySelectorAll<HTMLElement>('.b-thread__reply')]
    expect(rows).toHaveLength(2)
    const flat = rows[0]
    const nested = rows[1]
    if (flat === undefined || nested === undefined) throw new Error('reply rows missing')
    expect(flat.dataset['depth']).toBe('1')
    expect(nested.dataset['depth']).toBe('2')

    // a first level reply owns no rail
    expect(getComputedStyle(flat, '::before').content).toBe('none')

    // the nested one sits in its gutter and draws a hairline there
    const rail = getComputedStyle(nested, '::before')
    expect(rail.content).not.toBe('none')
    expect(rail.width).toBe('1px')
    const probe = document.createElement('span')
    probe.style.color = 'var(--line)'
    document.body.append(probe)
    const lineColor = getComputedStyle(probe).color
    probe.remove()
    expect(resolveSrgbColor(rail.backgroundColor)).toEqual(resolveSrgbColor(lineColor))
    expect(rail.left).toBe('-8px')
    expect(Number.parseFloat(getComputedStyle(nested).marginLeft)).toBeGreaterThan(0)
  })
})
