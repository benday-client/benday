import { beforeEach, describe, expect, it, vi } from 'vitest'
import { postFixture } from '../test/fixtures'
import {
  UNCONFIRMED_STATE,
  useActionStore,
  VIEWER_STALE_TIME,
  WRITE_CONFIRMATION_TIME,
} from './actionStore'
import {
  fetchViewerStates,
  likePost,
  repostPost,
  unlikePost,
  unrepostPost,
  type ViewerState,
} from './actions'

vi.mock('./actions', () => ({
  fetchViewerStates: vi.fn(),
  likePost: vi.fn(),
  unlikePost: vi.fn(),
  repostPost: vi.fn(),
  unrepostPost: vi.fn(),
}))

const URI = 'at://did:plc:test/app.bsky.feed.post/1'
const POST = postFixture({ uri: URI, likeCount: 2, repostCount: 1 })

function viewerState(state: Partial<ViewerState>): Map<string, ViewerState> {
  return new Map([[URI, { likeUri: state.likeUri ?? null, repostUri: state.repostUri ?? null }]])
}

function entry() {
  return useActionStore.getState().byUri[URI]
}

let now = 1_000_000

beforeEach(() => {
  useActionStore.getState().reset()
  vi.mocked(fetchViewerStates).mockReset()
  vi.mocked(likePost).mockReset()
  vi.mocked(unlikePost).mockReset()
  vi.mocked(repostPost).mockReset()
  vi.mocked(unrepostPost).mockReset()
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
})

describe('action store reads', () => {
  it('shares one pending viewer read between sync and a toggle', async () => {
    const read = Promise.withResolvers<Map<string, ViewerState>>()
    vi.mocked(fetchViewerStates).mockReturnValue(read.promise)
    vi.mocked(likePost).mockResolvedValue({ uri: 'at://like/1', cid: 'cid' })

    const sync = useActionStore.getState().syncViewer([URI])
    const toggle = useActionStore.getState().toggleLike(POST)
    expect(fetchViewerStates).toHaveBeenCalledTimes(1)

    read.resolve(viewerState({}))
    await sync
    await toggle

    expect(fetchViewerStates).toHaveBeenCalledTimes(1)
    expect(likePost).toHaveBeenCalledTimes(1)
    expect(entry()?.likeUri).toBe('at://like/1')
  })

  it('releases the lock and reports an unconfirmed state when the read fails', async () => {
    vi.mocked(fetchViewerStates).mockRejectedValue(new Error('viewer state unavailable'))
    await useActionStore.getState().toggleLike(POST)

    expect(likePost).not.toHaveBeenCalled()
    expect(entry()?.error).toBe(UNCONFIRMED_STATE)

    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({}))
    vi.mocked(likePost).mockResolvedValue({ uri: 'at://like/1', cid: 'cid' })
    await useActionStore.getState().toggleLike(POST)

    expect(fetchViewerStates).toHaveBeenCalledTimes(2)
    expect(entry()?.likeUri).toBe('at://like/1')
    expect(entry()?.error).toBeNull()
  })

  it('treats an omitted uri as unconfirmed and writes nothing', async () => {
    vi.mocked(fetchViewerStates).mockResolvedValue(new Map())

    await useActionStore.getState().toggleLike(POST)

    expect(likePost).not.toHaveBeenCalled()
    expect(entry()?.error).toBe(UNCONFIRMED_STATE)
  })

  it('does not repopulate entries after an account reset', async () => {
    const read = Promise.withResolvers<Map<string, ViewerState>>()
    vi.mocked(fetchViewerStates).mockReturnValue(read.promise)

    const sync = useActionStore.getState().syncViewer([URI])
    useActionStore.getState().reset()
    read.resolve(viewerState({ likeUri: 'at://like/foreign' }))
    await sync

    expect(useActionStore.getState().byUri).toEqual({})
  })

  it('drops a write result that lands after an account reset', async () => {
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({}))
    const write = Promise.withResolvers<{ uri: string; cid: string }>()
    vi.mocked(likePost).mockReturnValue(write.promise)

    const toggle = useActionStore.getState().toggleLike(POST)
    await vi.waitFor(() => expect(likePost).toHaveBeenCalled())

    useActionStore.getState().reset()
    write.resolve({ uri: 'at://like/1', cid: 'cid' })
    await toggle

    expect(useActionStore.getState().byUri).toEqual({})
  })
})

describe('action store freshness', () => {
  it('keeps a fresh local like until the confirmation deadline and accepts contradictions after it', async () => {
    const start = now
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({}))
    vi.mocked(likePost).mockResolvedValue({ uri: 'at://like/local', cid: 'cid' })

    // a canonical read at T
    await useActionStore.getState().syncViewer([URI])
    expect(entry()?.likeCheckedAt).toBe(start)

    // the write lands a second later with no second read, so the like side
    // stays fresh while the repost side ages out
    now = start + 1000
    await useActionStore.getState().toggleLike(POST)
    expect(fetchViewerStates).toHaveBeenCalledTimes(1)
    expect(entry()?.likeWrittenAt).toBe(start + 1000)
    expect(entry()?.repostCheckedAt).toBe(start)

    // at the repost deadline the sync does read, and that read still describes
    // the appview from before the write
    now = start + VIEWER_STALE_TIME
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({}))
    await useActionStore.getState().syncViewer([URI])
    expect(fetchViewerStates).toHaveBeenCalledTimes(2)
    expect(entry()?.likeUri).toBe('at://like/local')
    expect(entry()?.likeDelta).toBe(1)
    // freshness stays anchored at the write instead of the read
    expect(entry()?.likeCheckedAt).toBe(start + 1000)

    // past the write deadline the contradiction wins
    now = start + 1000 + WRITE_CONFIRMATION_TIME
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({}))
    await useActionStore.getState().syncViewer([URI])
    expect(fetchViewerStates).toHaveBeenCalledTimes(3)
    expect(entry()?.likeUri).toBeNull()
    expect(entry()?.likeDelta).toBe(0)
    expect(entry()?.likeBaseCount).toBeNull()
  })

  it('adopts canonical state after the stale window without a duplicate write', async () => {
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({ likeUri: 'at://like/old' }))
    await useActionStore.getState().syncViewer([URI])

    now += VIEWER_STALE_TIME
    vi.mocked(fetchViewerStates).mockResolvedValue(
      viewerState({ likeUri: 'at://like/elsewhere', repostUri: 'at://repost/elsewhere' }),
    )
    vi.mocked(unlikePost).mockResolvedValue(undefined)
    await useActionStore.getState().toggleLike(POST)

    expect(likePost).not.toHaveBeenCalled()
    // the removal follows the state the read just confirmed
    expect(unlikePost).toHaveBeenCalledWith('at://like/elsewhere')
    expect(entry()?.likeUri).toBeNull()
  })

  it('stamps only the side it wrote', async () => {
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({}))
    vi.mocked(likePost).mockResolvedValue({ uri: 'at://like/local', cid: 'cid' })
    vi.mocked(repostPost).mockResolvedValue({ uri: 'at://repost/local', cid: 'cid' })

    await useActionStore.getState().toggleLike(POST)
    const likeCheckedAt = entry()?.likeCheckedAt

    now += 1000
    await useActionStore.getState().toggleRepost(POST)

    expect(entry()?.repostCheckedAt).toBe(now)
    expect(entry()?.likeCheckedAt).toBe(likeCheckedAt)
  })

  it('does not write when the confirmed state already matches the request', async () => {
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({ likeUri: 'at://like/external' }))

    await useActionStore.getState().toggleLike(POST)

    expect(likePost).not.toHaveBeenCalled()
    expect(entry()?.likeUri).toBe('at://like/external')
  })

  it('clears a stale failure when a fresh read already satisfies the click', async () => {
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({}))
    vi.mocked(likePost).mockRejectedValueOnce(new Error('like refused'))

    await useActionStore.getState().toggleLike(POST)
    expect(entry()?.error).toBe('like refused')

    // the canonical state moved on while the alert sat there; a click past the
    // freshness window reads it and finds nothing left to write
    now += VIEWER_STALE_TIME
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({ likeUri: 'at://like/external' }))
    await useActionStore.getState().toggleLike(POST)

    expect(fetchViewerStates).toHaveBeenCalledTimes(2)
    expect(likePost).toHaveBeenCalledTimes(1)
    expect(entry()?.likeUri).toBe('at://like/external')
    expect(entry()?.likeDelta).toBe(0)
    expect(entry()?.error).toBeNull()
  })

  it('clears a stale repost failure when the fresh read satisfies the click', async () => {
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({}))
    vi.mocked(repostPost).mockRejectedValueOnce(new Error('repost refused'))

    await useActionStore.getState().toggleRepost(POST)
    expect(entry()?.error).toBe('repost refused')

    now += VIEWER_STALE_TIME
    vi.mocked(fetchViewerStates).mockResolvedValue(
      viewerState({ repostUri: 'at://repost/external' }),
    )
    await useActionStore.getState().toggleRepost(POST)

    expect(fetchViewerStates).toHaveBeenCalledTimes(2)
    expect(repostPost).toHaveBeenCalledTimes(1)
    expect(entry()?.repostUri).toBe('at://repost/external')
    expect(entry()?.error).toBeNull()
  })

  it('keeps the count honest after a rejected repost and lets another attempt succeed', async () => {
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({}))
    vi.mocked(repostPost).mockRejectedValueOnce(new Error('repost refused'))

    await useActionStore.getState().toggleRepost(POST)

    expect(entry()?.repostUri).toBeNull()
    expect(entry()?.repostDelta).toBe(0)
    expect(entry()?.pending).toBeNull()
    expect(entry()?.error).toBe('repost refused')

    vi.mocked(repostPost).mockResolvedValue({ uri: 'at://repost/1', cid: 'cid' })
    await useActionStore.getState().toggleRepost(POST)

    expect(entry()?.repostUri).toBe('at://repost/1')
    expect(entry()?.repostDelta).toBe(1)
    expect(entry()?.error).toBeNull()
  })

  it('locks the repost side against a repeated click while a write is in flight', async () => {
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({}))
    const gate = Promise.withResolvers<{ uri: string; cid: string }>()
    vi.mocked(repostPost).mockReturnValue(gate.promise)

    const first = useActionStore.getState().toggleRepost(POST)
    await vi.waitFor(() => expect(repostPost).toHaveBeenCalledTimes(1))

    // the write is in flight, so a second click has nothing to add
    await useActionStore.getState().toggleRepost(POST)

    expect(repostPost).toHaveBeenCalledTimes(1)
    expect(entry()?.pending).toBe('repost')

    gate.resolve({ uri: 'at://repost/1', cid: 'cid' })
    await first

    expect(entry()?.repostUri).toBe('at://repost/1')
    expect(entry()?.pending).toBeNull()
  })

  it('keeps the count honest after a rejected like and lets another attempt succeed', async () => {
    vi.mocked(fetchViewerStates).mockResolvedValue(viewerState({}))
    vi.mocked(likePost).mockRejectedValueOnce(new Error('like refused'))

    await useActionStore.getState().toggleLike(POST)

    expect(entry()?.likeUri).toBeNull()
    expect(entry()?.likeDelta).toBe(0)
    expect(entry()?.pending).toBeNull()
    expect(entry()?.error).toBe('like refused')

    vi.mocked(likePost).mockResolvedValue({ uri: 'at://like/1', cid: 'cid' })
    await useActionStore.getState().toggleLike(POST)

    expect(entry()?.likeUri).toBe('at://like/1')
    expect(entry()?.likeDelta).toBe(1)
    expect(entry()?.error).toBeNull()
  })
})
