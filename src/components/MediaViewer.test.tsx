import { fireEvent, render, screen } from '@testing-library/react'
import { Profiler } from 'react'
import { describe, expect, it } from 'vitest'
import { type MediaItem, MediaViewer } from './MediaViewer'

function imageItem(id: number): MediaItem {
  const src = `https://cdn.test/${id}.jpg`
  return {
    kind: 'image',
    src,
    alt: `image ${id}`,
    image: { thumb: src, fullsize: src, alt: `image ${id}`, width: 4, height: 3 },
  }
}

const images = (count: number) => Array.from({ length: count }, (_, index) => imageItem(index + 1))

interface ViewerProps {
  open: boolean
  items: MediaItem[]
  initialIndex?: number
}

/**
 * Records the resource the viewer commits. The Profiler reads the live stage on
 * every commit, and the mutation trail catches the one thing a commit record
 * cannot: the viewer unmounting mid-list, which the reader sees as the pane
 * blinking out before the clamped image returns.
 */
function renderViewer(initial: ViewerProps) {
  const committed: string[] = []
  const removals: string[] = []

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (node instanceof HTMLImageElement && node.classList.contains('b-media-viewer__image')) {
          const src = node.getAttribute('src')
          if (src !== null) removals.push(src)
        }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  const ui = (props: ViewerProps) => (
    <Profiler
      id="media-viewer"
      onRender={() => {
        const image = document.querySelector('.b-media-viewer__stage img')
        committed.push(image?.getAttribute('src') ?? 'missing')
      }}
    >
      <MediaViewer {...props} onClose={() => {}} />
    </Profiler>
  )

  const result = render(ui(initial))

  return {
    ...result,
    committed,
    removals,
    // MutationObserver records arrive on the microtask queue
    flush: () => {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 0)
      return promise
    },
    show: (props: ViewerProps) => {
      result.rerender(ui(props))
    },
    stop: () => {
      observer.disconnect()
    },
  }
}

describe('MediaViewer navigation keys', () => {
  function renderOpen(count: number, initialIndex = 0) {
    render(
      <MediaViewer open items={images(count)} initialIndex={initialIndex} onClose={() => {}} />,
    )
  }

  it('moves with j and k on the visual axis', () => {
    renderOpen(4)
    expect(screen.getByText('1 / 4')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'j' })
    expect(screen.getByText('2 / 4')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'j' })
    expect(screen.getByText('3 / 4')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'k' })
    expect(screen.getByText('2 / 4')).toBeInTheDocument()

    // the visual axis wraps like the arrow keys do
    fireEvent.keyDown(window, { key: 'k' })
    fireEvent.keyDown(window, { key: 'k' })
    expect(screen.getByText('4 / 4')).toBeInTheDocument()
  })

  it('jumps to the first and last item with Home and End', () => {
    renderOpen(5, 2)
    expect(screen.getByText('3 / 5')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'End' })
    expect(screen.getByText('5 / 5')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Home' })
    expect(screen.getByText('1 / 5')).toBeInTheDocument()
  })

  it('selects a 1-based position with the digit keys', () => {
    renderOpen(4)
    fireEvent.keyDown(window, { key: '3' })
    expect(screen.getByText('3 / 4')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '1' })
    expect(screen.getByText('1 / 4')).toBeInTheDocument()

    // past the end is inert rather than clamped
    fireEvent.keyDown(window, { key: '3' })
    fireEvent.keyDown(window, { key: '9' })
    expect(screen.getByText('3 / 4')).toBeInTheDocument()
  })

  it('ignores keys that belong to an active composition', () => {
    renderOpen(4)
    const composing = new KeyboardEvent('keydown', {
      key: 'j',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(window, composing)
    expect(screen.getByText('1 / 4')).toBeInTheDocument()
  })
})

describe('MediaViewer index ownership', () => {
  it('reopens on the requested image instead of the one it was showing', async () => {
    const items = images(3)
    const view = renderViewer({ open: true, items })

    fireEvent.click(screen.getByRole('button', { name: 'next image' }))
    expect(view.committed.at(-1)).toBe('https://cdn.test/2.jpg')
    await view.flush()

    view.committed.length = 0
    view.show({ open: false, items })
    await view.flush()
    view.show({ open: true, items })
    await view.flush()

    expect(view.committed).toContain('https://cdn.test/1.jpg')
    expect(view.committed).not.toContain('https://cdn.test/2.jpg')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    view.stop()
  })

  it('never commits a missing resource or unmounts when the list shrinks', async () => {
    const items = images(3)
    const view = renderViewer({ open: true, items })

    fireEvent.click(screen.getByRole('button', { name: 'next image' }))
    fireEvent.click(screen.getByRole('button', { name: 'next image' }))
    expect(view.committed.at(-1)).toBe('https://cdn.test/3.jpg')
    await view.flush()

    view.committed.length = 0
    view.removals.length = 0
    view.show({ open: true, items: items.slice(0, 2) })
    await view.flush()

    expect(view.removals).toEqual([])
    expect(view.committed).not.toContain('missing')
    expect(view.committed.at(-1)).toBe('https://cdn.test/2.jpg')
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    view.stop()
  })

  it('honours a changed starting index before the next commit', async () => {
    const items = images(3)
    const view = renderViewer({ open: true, items, initialIndex: 0 })
    expect(view.committed.at(-1)).toBe('https://cdn.test/1.jpg')

    view.committed.length = 0
    view.show({ open: true, items, initialIndex: 2 })
    await view.flush()

    expect(view.committed).not.toContain('https://cdn.test/2.jpg')
    expect(view.committed.at(-1)).toBe('https://cdn.test/3.jpg')
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    view.stop()
  })

  it('clamps an out-of-range starting index', async () => {
    const view = renderViewer({ open: true, items: images(2), initialIndex: 9 })

    expect(view.committed).not.toContain('missing')
    expect(view.committed.at(-1)).not.toBe('missing')
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    view.stop()
  })

  it('renders no viewer at all for an empty list', async () => {
    const view = renderViewer({ open: true, items: [] })

    expect(document.querySelector('dialog.b-media-viewer')).toBeNull()
    expect(view.container.childElementCount).toBe(0)

    view.show({ open: true, items: images(1) })
    await view.flush()
    expect(view.committed.at(-1)).toBe('https://cdn.test/1.jpg')

    view.show({ open: true, items: [] })
    await view.flush()
    expect(document.querySelector('dialog.b-media-viewer')).toBeNull()
    view.stop()
  })
})

describe('MediaViewer count region', () => {
  it('announces the active alt with the count and keeps the visible alt in step', () => {
    render(<MediaViewer open items={images(3)} onClose={() => {}} />)

    const count = document.querySelector('.b-media-viewer__count')
    if (count === null) throw new Error('count region missing')
    expect(count.getAttribute('aria-live')).toBe('polite')
    expect(count.getAttribute('aria-atomic')).toBe('true')
    expect(count.textContent).toBe('1 / 3 — image 1')
    expect(document.querySelector('.b-media-viewer__alt')?.textContent).toBe('image 1')

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(document.querySelector('.b-media-viewer__count')?.textContent).toBe('2 / 3 — image 2')
    expect(document.querySelector('.b-media-viewer__alt')?.textContent).toBe('image 2')
  })

  it('appends no alt for a video position', () => {
    const items: MediaItem[] = [
      {
        kind: 'video',
        video: { type: 'video', thumbnail: null, alt: 'a clip', playlist: null },
      },
      imageItem(2),
    ]
    render(<MediaViewer open items={items} onClose={() => {}} />)

    expect(document.querySelector('.b-media-viewer__count')?.textContent).toBe('1 / 2')
  })
})
