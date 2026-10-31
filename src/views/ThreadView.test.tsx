import { act, fireEvent, render, screen } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Router, useLocation } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { goBackOrFallback, THREAD_FALLBACK_VIEW } from '../lib/history'
import { useSettings } from '../lib/store'
import type { PostModel, ThreadEntry, ThreadModel } from '../lib/types'
import { useUiStore } from '../lib/ui'
import { postFixture } from '../test/fixtures'
import ThreadView, { threadParentTarget } from './ThreadView'

const threadState = vi.hoisted(() => ({
  data: null as ThreadModel | null,
  isPending: false,
  isFetching: false,
  error: null as Error | null,
  retries: 0,
}))

vi.mock('../hooks/useBskyQueries', () => ({
  useThread: () => ({
    data: threadState.data,
    isPending: threadState.isPending,
    isFetching: threadState.isFetching,
    error: threadState.error,
    // a refetch clears the query error before its data arrives, exactly like
    // tanstack query does when there is no cached result to keep showing
    retry: () => {
      threadState.retries += 1
      threadState.error = null
      threadState.isFetching = true
    },
  }),
}))

vi.mock('../hooks/useViewerSync', () => ({ useViewerSync: () => undefined }))

// the keyboard wiring lives in the view, so the card and the dock only need to
// forward the reply list the view builds
vi.mock('../components/PostCard', () => ({
  PostCard: ({ post, replies }: { post: PostModel; replies?: ReactNode }) => (
    <div data-testid="focus-post">
      <span>{post.uri}</span>
      {replies}
    </div>
  ),
}))

vi.mock('../components/InlineComposer', () => ({ InlineComposer: () => null }))

function parentedPost(uri: string, parentUri: string | null): PostModel {
  return postFixture({
    uri,
    isReply: parentUri !== null,
    replyParent: parentUri === null ? null : { uri: parentUri, cid: `${parentUri}-cid` },
  })
}

function threadWith(post: PostModel, replyPosts: PostModel[] = []): ThreadModel {
  const entries: ThreadEntry[] = [{ post, depth: 0, role: 'focus' }]
  for (const replyPost of replyPosts) entries.push({ post: replyPost, depth: 1, role: 'reply' })
  return { focusUri: post.uri, entries }
}

function threadTree(post: PostModel, replies: { post: PostModel; depth: number }[]): ThreadModel {
  const entries: ThreadEntry[] = [{ post, depth: 0, role: 'focus' }]
  for (const reply of replies) entries.push({ post: reply.post, depth: reply.depth, role: 'reply' })
  return { focusUri: post.uri, entries }
}

/**
 * App's Escape layer, reduced to the one branch a thread exercises: an
 * unconsumed Escape leaves the route through the shared history helper, so at
 * a root thread Escape and left agree on the destination.
 */
function BackLayer({ children }: { children: ReactNode }) {
  const [, navigate] = useLocation()

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return
      event.preventDefault()
      goBackOrFallback(navigate, THREAD_FALLBACK_VIEW)
    }
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [navigate])

  return <>{children}</>
}

function renderThread(uri: string, options: { backLayer?: boolean } = {}) {
  const memory = memoryLocation({ path: `/thread?uri=${encodeURIComponent(uri)}`, record: true })
  // every call builds fresh elements: a rerender that reused the previous
  // child element would let React bail out and hide the mocked transition
  const tree = (): ReactNode => {
    const view = (
      <>
        <ThreadView />
        <textarea data-testid="editor" />
      </>
    )
    return (
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        {options.backLayer === true ? <BackLayer>{view}</BackLayer> : view}
      </Router>
    )
  }
  const rendered = render(tree())
  return {
    memory,
    rerender: () => rendered.rerender(tree()),
    unmount: () => rendered.unmount(),
  }
}

function threadUrl(uri: string): string {
  return `/thread?uri=${encodeURIComponent(uri)}`
}

/** Marks this browser document as having app-owned entries behind it. */
function seedHistoryDepth(depth: number): void {
  window.history.replaceState({ __bendayHistory: { depth } }, '')
}

function resetThreadState(): void {
  threadState.data = null
  threadState.isPending = false
  threadState.isFetching = false
  threadState.error = null
  threadState.retries = 0
  useUiStore.setState({ dialog: null, compose: null, inlineCompose: null, openingPost: null })
}

beforeEach(() => {
  resetThreadState()
  window.history.replaceState(null, '')
})

afterEach(() => {
  // settle the pending-back latch so one case cannot swallow the next pop
  window.dispatchEvent(new Event('popstate'))
  window.history.replaceState(null, '')
})

describe('threadParentTarget', () => {
  it('uses the focus post parent', () => {
    const focusPost = parentedPost('at://focus', 'at://parent')
    expect(threadParentTarget(focusPost, null)).toBe('at://parent')
  })

  it('returns null when there is nothing to walk up to', () => {
    expect(threadParentTarget(parentedPost('at://root', null), null)).toBeNull()
    expect(threadParentTarget(null, null)).toBeNull()
  })

  it('prefers the focused reply parent and never falls back to the focus post', () => {
    const focusPost = parentedPost('at://focus', 'at://focus-parent')
    const replyPost = parentedPost('at://reply', 'at://reply-parent')
    expect(threadParentTarget(focusPost, replyPost)).toBe('at://reply-parent')
    expect(threadParentTarget(focusPost, parentedPost('at://reply', null))).toBeNull()
  })
})

describe('ThreadView parent navigation', () => {
  it('p opens the thread of the post the focus post replies to', () => {
    const focusPost = parentedPost('at://focus', 'at://parent')
    threadState.data = threadWith(focusPost)
    const { memory } = renderThread(focusPost.uri)

    fireEvent.keyDown(document.body, { key: 'p' })

    expect(memory.history).toEqual([threadUrl('at://focus'), threadUrl('at://parent')])
  })

  it('p walks up from the focused reply instead of the focus post', () => {
    const focusPost = parentedPost('at://focus', 'at://focus-parent')
    const replyPost = parentedPost('at://reply', 'at://reply-parent')
    threadState.data = threadWith(focusPost, [replyPost])
    const { memory } = renderThread(focusPost.uri)

    const reply = document.querySelector<HTMLElement>('.b-thread__reply')
    if (reply === null) throw new Error('missing reply article')
    act(() => {
      reply.focus()
    })
    expect(document.activeElement).toBe(reply)
    fireEvent.keyDown(reply, { key: 'p' })

    expect(memory.history.at(-1)).toBe(threadUrl('at://reply-parent'))
  })

  it('p navigates nowhere when the post has no parent', () => {
    const focusPost = parentedPost('at://root', null)
    threadState.data = threadWith(focusPost)
    const { memory } = renderThread(focusPost.uri)

    fireEvent.keyDown(document.body, { key: 'p' })

    expect(memory.history).toEqual([threadUrl('at://root')])
  })

  it('ignores p typed into a text field', () => {
    const focusPost = parentedPost('at://focus', 'at://parent')
    threadState.data = threadWith(focusPost)
    const { memory } = renderThread(focusPost.uri)

    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'p' })

    expect(memory.history).toEqual([threadUrl('at://focus')])
  })

  it('ignores p while a dialog is open', () => {
    const focusPost = parentedPost('at://focus', 'at://parent')
    threadState.data = threadWith(focusPost)
    const { memory } = renderThread(focusPost.uri)
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)

    try {
      fireEvent.keyDown(document.body, { key: 'p' })
    } finally {
      dialog.remove()
    }

    expect(memory.history).toEqual([threadUrl('at://focus')])
  })

  it('ignores p while the ui store owns the keyboard', () => {
    const focusPost = parentedPost('at://focus', 'at://parent')
    threadState.data = threadWith(focusPost)
    const { memory } = renderThread(focusPost.uri)

    act(() => {
      useUiStore.setState({ dialog: 'help' })
    })
    fireEvent.keyDown(document.body, { key: 'p' })

    expect(memory.history).toEqual([threadUrl('at://focus')])
  })

  it('ignores modified and repeated presses', () => {
    const focusPost = parentedPost('at://focus', 'at://parent')
    threadState.data = threadWith(focusPost)
    const { memory } = renderThread(focusPost.uri)

    fireEvent.keyDown(document.body, { key: 'p', shiftKey: true })
    fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'p', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'p', altKey: true })
    fireEvent.keyDown(document.body, { key: 'p', repeat: true })

    expect(memory.history).toEqual([threadUrl('at://focus')])
  })

  it('ignores a p another layer already handled', () => {
    const focusPost = parentedPost('at://focus', 'at://parent')
    threadState.data = threadWith(focusPost)
    const { memory } = renderThread(focusPost.uri)
    const event = new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true })
    event.preventDefault()

    document.body.dispatchEvent(event)

    expect(memory.history).toEqual([threadUrl('at://focus')])
  })
})

describe('ThreadView reply keys', () => {
  function renderReplies(options: { backLayer?: boolean } = {}) {
    const focusPost = parentedPost('at://focus', null)
    const first = postFixture({ uri: 'at://reply-1', text: 'first reply' })
    const second = postFixture({ uri: 'at://reply-2', text: 'second reply' })
    threadState.data = threadWith(focusPost, [first, second])
    const rendered = renderThread(focusPost.uri, options)
    const replies = Array.from(document.querySelectorAll<HTMLElement>('.b-thread__reply'))
    const [one, two] = replies
    if (one === undefined || two === undefined) throw new Error('missing reply articles')
    return { ...rendered, replies: [one, two] as const }
  }

  it('enters the first reply with j and then moves to the next', () => {
    const { replies } = renderReplies()

    fireEvent.keyDown(document.body, { key: 'j' })
    expect(document.activeElement).toBe(replies[0])

    fireEvent.keyDown(replies[0], { key: 'j' })
    expect(document.activeElement).toBe(replies[1])

    fireEvent.keyDown(replies[1], { key: 'j' })
    expect(document.activeElement).toBe(replies[1])
  })

  it('walks back with k and stops at the focus post', () => {
    const { memory, replies } = renderReplies()

    fireEvent.keyDown(document.body, { key: 'j' })
    fireEvent.keyDown(replies[0], { key: 'j' })
    expect(document.activeElement).toBe(replies[1])

    fireEvent.keyDown(replies[1], { key: 'k' })
    expect(document.activeElement).toBe(replies[0])

    fireEvent.keyDown(replies[0], { key: 'k' })
    expect(document.activeElement).toBe(document.querySelector('.b-thread'))
    expect(memory.history).toEqual([threadUrl('at://focus')])
  })

  it('jumps to the last and first reply with End and Home', () => {
    const { replies } = renderReplies()

    fireEvent.keyDown(document.body, { key: 'End' })
    expect(document.activeElement).toBe(replies[1])

    fireEvent.keyDown(replies[1], { key: 'Home' })
    expect(document.activeElement).toBe(replies[0])
  })

  it('does not leave a root thread with arrow up at the opened post', () => {
    const { memory } = renderReplies()

    fireEvent.keyDown(document.body, { key: 'ArrowUp' })

    expect(memory.history).toEqual([threadUrl('at://focus')])
  })

  it('does not leave a root thread with k at the opened post', () => {
    const { memory } = renderReplies()

    fireEvent.keyDown(document.body, { key: 'k' })

    expect(memory.history).toEqual([threadUrl('at://focus')])
  })

  it('walks into the first reply and back to the opened post, then leaves with left', () => {
    const { memory, replies } = renderReplies()

    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(replies[0])
    expect(memory.history).toEqual([threadUrl('at://focus')])

    fireEvent.keyDown(replies[0], { key: 'ArrowUp' })
    const thread = document.querySelector('.b-thread')
    if (!(thread instanceof HTMLElement)) throw new Error('missing thread surface')
    expect(document.activeElement).toBe(thread)
    expect(memory.history).toEqual([threadUrl('at://focus')])

    fireEvent.keyDown(thread, { key: 'ArrowLeft' })
    expect(memory.history).toEqual([THREAD_FALLBACK_VIEW])
  })

  it('still leaves the thread with Escape', () => {
    const { memory } = renderReplies({ backLayer: true })

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(memory.history).toEqual([THREAD_FALLBACK_VIEW])
  })

  it('ignores up inside a text field', () => {
    const { memory } = renderReplies()

    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'k' })

    expect(memory.history).toEqual([threadUrl('at://focus')])
  })

  it('ignores up while the parent link is focused', () => {
    const focusPost = parentedPost('at://focus', 'at://parent')
    threadState.data = threadWith(focusPost, [postFixture({ uri: 'at://reply-1' })])
    const { memory } = renderThread(focusPost.uri)
    const link = document.querySelector('.b-thread__parent-link')
    if (!(link instanceof HTMLElement)) throw new Error('missing parent link')

    fireEvent.keyDown(link, { key: 'ArrowUp' })
    fireEvent.keyDown(link, { key: 'k' })

    expect(memory.history).toEqual([threadUrl('at://focus')])
  })

  it('opens the focused reply with enter and not with space', () => {
    const { memory, replies } = renderReplies()

    act(() => {
      replies[0].focus()
    })
    expect(document.activeElement).toBe(replies[0])

    fireEvent.keyDown(replies[0], { key: ' ' })
    expect(memory.history).toEqual([threadUrl('at://focus')])

    fireEvent.keyDown(replies[0], { key: 'Enter' })
    expect(memory.history.at(-1)).toBe(threadUrl('at://reply-1'))
  })
})

describe('ThreadView reply tree', () => {
  function renderTree() {
    const focusPost = parentedPost('at://focus', null)
    const first = parentedPost('at://reply-1', focusPost.uri)
    const child = parentedPost('at://reply-1-child', first.uri)
    const second = parentedPost('at://reply-2', focusPost.uri)
    threadState.data = threadTree(focusPost, [
      { post: first, depth: 1 },
      { post: child, depth: 2 },
      { post: second, depth: 1 },
    ])
    const rendered = renderThread(focusPost.uri)
    const replies = Array.from(document.querySelectorAll<HTMLElement>('.b-thread__reply'))
    const [one, nested, two] = replies
    if (one === undefined || nested === undefined || two === undefined) {
      throw new Error('missing reply articles')
    }
    return { ...rendered, replies: [one, nested, two] as const }
  }

  function threadSurface(): HTMLElement {
    const thread = document.querySelector<HTMLElement>('.b-thread')
    if (thread === null) throw new Error('missing thread surface')
    return thread
  }

  it('moves down from the opened post to its first child', () => {
    const { replies } = renderTree()

    fireEvent.keyDown(document.body, { key: 'ArrowDown' })

    expect(document.activeElement).toBe(replies[0])
  })

  it('moves down from a reply to its child before the next sibling', () => {
    const { replies } = renderTree()

    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(replies[0])

    fireEvent.keyDown(replies[0], { key: 'ArrowDown' })

    expect(document.activeElement).toBe(replies[1])
  })

  it('moves down from a leaf to the next visible reply', () => {
    const { replies } = renderTree()

    act(() => {
      replies[1].focus()
    })
    fireEvent.keyDown(replies[1], { key: 'ArrowDown' })

    expect(document.activeElement).toBe(replies[2])
  })

  it('stays put with down on the last reply', () => {
    const { replies } = renderTree()

    act(() => {
      replies[2].focus()
    })
    fireEvent.keyDown(replies[2], { key: 'ArrowDown' })

    expect(document.activeElement).toBe(replies[2])
  })

  it('moves up from a child to its parent reply', () => {
    const { replies } = renderTree()

    act(() => {
      replies[1].focus()
    })
    fireEvent.keyDown(replies[1], { key: 'ArrowUp' })

    expect(document.activeElement).toBe(replies[0])
  })

  it('moves up from a top-level reply to the opened post', () => {
    const { replies } = renderTree()

    act(() => {
      replies[0].focus()
    })
    fireEvent.keyDown(replies[0], { key: 'ArrowUp' })

    expect(document.activeElement).toBe(threadSurface())
  })

  it('keeps j and k in reading order across the tree', () => {
    const { replies } = renderTree()

    fireEvent.keyDown(document.body, { key: 'j' })
    expect(document.activeElement).toBe(replies[0])

    fireEvent.keyDown(replies[0], { key: 'j' })
    expect(document.activeElement).toBe(replies[1])

    fireEvent.keyDown(replies[1], { key: 'j' })
    expect(document.activeElement).toBe(replies[2])

    fireEvent.keyDown(replies[2], { key: 'k' })
    expect(document.activeElement).toBe(replies[1])
  })

  it('leaves the thread with left from a focused reply', () => {
    const { memory, replies } = renderTree()

    act(() => {
      replies[1].focus()
    })
    fireEvent.keyDown(replies[1], { key: 'ArrowLeft' })

    expect(memory.history).toEqual([THREAD_FALLBACK_VIEW])
  })
})

describe('ThreadView focus parent boundary', () => {
  function renderParented(options: { backLayer?: boolean } = {}) {
    const focusPost = parentedPost('at://focus', 'at://focus-parent')
    threadState.data = threadWith(focusPost, [postFixture({ uri: 'at://reply-1' })])
    return { focusPost, ...renderThread(focusPost.uri, options) }
  }

  function replyArticle(): HTMLElement {
    const reply = document.querySelector<HTMLElement>('.b-thread__reply')
    if (reply === null) throw new Error('missing reply article')
    return reply
  }

  function threadSurface(): HTMLElement {
    const thread = document.querySelector<HTMLElement>('.b-thread')
    if (thread === null) throw new Error('missing thread surface')
    return thread
  }

  it('opens the parent thread with arrow up at a parented focus post', () => {
    const { memory } = renderParented()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    fireEvent.keyDown(document.body, { key: 'ArrowUp' })

    expect(back).not.toHaveBeenCalled()
    expect(memory.history).toEqual([threadUrl('at://focus'), threadUrl('at://focus-parent')])
    back.mockRestore()
  })

  it('does not open the parent thread with k at a parented focus post', () => {
    seedHistoryDepth(1)
    const { memory } = renderParented()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    fireEvent.keyDown(document.body, { key: 'k' })

    expect(back).not.toHaveBeenCalled()
    expect(memory.history).toEqual([threadUrl('at://focus')])
    back.mockRestore()
  })

  it('does not reopen the parent on a held up key', () => {
    const { memory } = renderParented()

    fireEvent.keyDown(document.body, { key: 'ArrowUp', repeat: true })

    expect(memory.history).toEqual([threadUrl('at://focus')])
  })

  it('walks a reply back through the focus post before the parent thread', () => {
    const { memory } = renderParented()

    fireEvent.keyDown(document.body, { key: 'j' })
    expect(document.activeElement).toBe(replyArticle())

    fireEvent.keyDown(replyArticle(), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(threadSurface())
    expect(memory.history).toEqual([threadUrl('at://focus')])

    fireEvent.keyDown(threadSurface(), { key: 'ArrowUp' })
    expect(memory.history).toEqual([threadUrl('at://focus'), threadUrl('at://focus-parent')])
  })
})

describe('ThreadView leave history', () => {
  function renderRootThread(options: { backLayer?: boolean } = {}) {
    const focusPost = parentedPost('at://focus', null)
    threadState.data = threadWith(focusPost)
    return renderThread(focusPost.uri, options)
  }

  it('replaces a directly opened thread with the feed instead of popping', () => {
    const { memory } = renderRootThread()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })

    expect(back).not.toHaveBeenCalled()
    expect(memory.history).toEqual([THREAD_FALLBACK_VIEW])
  })

  it('treats a foreign predecessor with unmarked state as no app history', () => {
    window.history.replaceState({ from: 'elsewhere' }, '')
    const { memory } = renderRootThread()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })

    expect(back).not.toHaveBeenCalled()
    expect(memory.history).toEqual([THREAD_FALLBACK_VIEW])
  })

  it('steps back through one app entry when the history marker says so', () => {
    seedHistoryDepth(2)
    const { memory } = renderRootThread()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })

    expect(back).toHaveBeenCalledTimes(1)
    expect(memory.history).toEqual([threadUrl('at://focus')])
  })

  it('drops a second leave in the same tick so only one entry pops', () => {
    seedHistoryDepth(1)
    const { memory } = renderRootThread()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })

    expect(back).toHaveBeenCalledTimes(1)
    expect(memory.history).toEqual([threadUrl('at://focus')])
  })

  it('has Escape and left agree on the fallback at the route root', () => {
    const viaKey = renderRootThread()
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(viaKey.memory.history).toEqual([THREAD_FALLBACK_VIEW])
    viaKey.unmount()

    const viaEscape = renderRootThread({ backLayer: true })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(viaEscape.memory.history).toEqual([THREAD_FALLBACK_VIEW])
  })

  it('has Escape and left agree on stepping back when app history exists', () => {
    seedHistoryDepth(1)
    const viaKey = renderRootThread()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(back).toHaveBeenCalledTimes(1)
    expect(viaKey.memory.history).toEqual([threadUrl('at://focus')])
    viaKey.unmount()

    // settle the latch before the Escape path checks the same contract
    window.dispatchEvent(new Event('popstate'))

    const viaEscape = renderRootThread({ backLayer: true })
    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(back).toHaveBeenCalledTimes(2)
    expect(viaEscape.memory.history).toEqual([threadUrl('at://focus')])
  })
})

describe('ThreadView reply dock Escape', () => {
  function openDock() {
    const focusPost = parentedPost('at://focus', null)
    threadState.data = threadWith(focusPost)
    renderThread(focusPost.uri)
    act(() => {
      useUiStore.getState().openInlineCompose({ mode: 'reply', post: focusPost })
    })
    expect(useUiStore.getState().inlineCompose).not.toBeNull()
    return focusPost
  }

  function dispatchEscape(init: { isComposing?: boolean; keyCode?: number }): void {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
      isComposing: init.isComposing ?? false,
    })
    if (init.keyCode !== undefined) {
      Object.defineProperty(event, 'keyCode', { value: init.keyCode })
    }
    act(() => {
      window.dispatchEvent(event)
    })
  }

  it('keeps the reply dock open while the IME is composing', () => {
    openDock()

    dispatchEscape({ isComposing: true })
    dispatchEscape({ keyCode: 229 })

    expect(useUiStore.getState().inlineCompose).not.toBeNull()
  })

  it('closes the reply dock on a plain Escape', () => {
    openDock()

    dispatchEscape({})

    expect(useUiStore.getState().inlineCompose).toBeNull()
  })
})

describe('ThreadView loading and recovery', () => {
  it('names the pending thread progress for the replies it loads', () => {
    threadState.isPending = true
    renderThread('at://focus')

    expect(screen.getByRole('progressbar', { name: 'loading replies' })).toBeInTheDocument()
  })

  it('names the replies progress inside the post opened from a deck', () => {
    const focusPost = parentedPost('at://focus', null)
    // the card renders from the post the route was opened with while the
    // thread request is still pending, so its reply list is the loading state
    useUiStore.setState({ openingPost: focusPost })
    threadState.data = { focusUri: focusPost.uri, entries: [] }
    threadState.isPending = true
    renderThread(focusPost.uri)

    expect(screen.getByTestId('focus-post')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'loading replies' })).toBeInTheDocument()
  })

  it('keeps the visible failure announced and blocks a repeat retry while refetching', () => {
    threadState.error = new Error('thread unavailable')
    const { rerender } = renderThread('at://focus')

    expect(screen.getByRole('alert')).toHaveTextContent('thread unavailable')
    const retry = screen.getByRole('button', { name: 'retry' })
    expect(retry).not.toHaveAttribute('aria-disabled', 'true')
    retry.focus()
    expect(document.activeElement).toBe(retry)

    fireEvent.click(retry)

    // the refetch cleared the query error before its data arrived, yet the
    // failure the reader is focused on must stay on screen and stay announced
    expect(threadState.error).toBeNull()
    expect(threadState.isFetching).toBe(true)
    expect(screen.getByRole('alert')).toHaveTextContent('thread unavailable')
    const busyRetry = screen.getByRole('button', { name: 'retry' })
    expect(document.activeElement).toBe(busyRetry)
    expect(busyRetry).toHaveAttribute('aria-disabled', 'true')
    expect(busyRetry).toHaveAttribute('aria-busy', 'true')

    fireEvent.click(busyRetry)
    expect(threadState.retries).toBe(1)

    threadState.data = threadWith(parentedPost('at://focus', null))
    threadState.isFetching = false
    act(() => {
      rerender()
    })

    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('ThreadView character shortcut opt-out', () => {
  beforeEach(() => {
    useSettings.setState({ keyboardShortcuts: false })
  })

  afterEach(() => {
    useSettings.setState({ keyboardShortcuts: true })
  })

  it('leaves p j k and digits inert while arrows still walk the thread', () => {
    const focusPost = parentedPost('at://focus', 'at://parent')
    const replyPost = parentedPost('at://reply', focusPost.uri)
    threadState.data = threadWith(focusPost, [replyPost])
    const { memory } = renderThread(focusPost.uri)

    fireEvent.keyDown(document.body, { key: 'p' })
    fireEvent.keyDown(document.body, { key: 'j' })
    fireEvent.keyDown(document.body, { key: 'k' })
    fireEvent.keyDown(document.body, { key: '1' })
    expect(memory.history).toEqual([threadUrl('at://focus')])
    expect(document.activeElement).toBe(document.body)

    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    const reply = document.querySelector<HTMLElement>('.b-thread__reply')
    expect(reply).not.toBeNull()
    expect(document.activeElement).toBe(reply)

    // the reply-focused handler is a second ladder: it must obey the opt-out too
    fireEvent.keyDown(reply as HTMLElement, { key: 'j' })
    fireEvent.keyDown(reply as HTMLElement, { key: 'k' })
    fireEvent.keyDown(reply as HTMLElement, { key: 'End' })
    expect(document.activeElement).toBe(reply)
    expect(memory.history).toEqual([threadUrl('at://focus')])

    // enter is not a character shortcut, so a focused reply still opens
    fireEvent.keyDown(reply as HTMLElement, { key: 'Enter' })
    expect(memory.history.at(-1)).toBe(threadUrl('at://reply'))
  })
})
