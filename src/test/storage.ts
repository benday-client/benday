import { act } from '@testing-library/react'
import { vi } from 'vitest'

/**
 * Fails storage reads while the switch says so, delegating to real storage
 * otherwise.
 */
export function stubStorageReads() {
  const original = Storage.prototype.getItem
  let failing = true
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (failing) throw new Error('storage read denied')
    return original.call(this, key)
  })
  return {
    deny: () => {
      failing = true
    },
    allow: () => {
      failing = false
    },
  }
}

/** Fails `count` writes, then delegates to real storage; Infinity keeps failing. */
export function failWrites(count = Number.POSITIVE_INFINITY) {
  const original = Storage.prototype.setItem
  let remaining = count
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (remaining > 0) {
      remaining -= 1
      throw new Error('storage write denied')
    }
    original.call(this, key, value)
  })
  return {
    allow: () => {
      remaining = 0
    },
  }
}

/** Lets the autosave delay elapse, including the write it attempts. */
export async function settleAutosave() {
  const elapsed = Promise.withResolvers<void>()
  setTimeout(elapsed.resolve, 300)
  await act(async () => {
    await elapsed.promise
  })
}
