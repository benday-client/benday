import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { clearTestQueryClients } from './queryClient'
import { assertNoUnmatchedRequests, resetTransportRequests } from './transport'

let unexpectedRequests: string[] = []
let installed = false

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * Environment-agnostic test hygiene shared by the jsdom and native-browser
 * setups: no test may reach the network by accident, rendered trees and tracked
 * query clients are torn down, and storage is emptied between cases.
 */
export function installTestHygiene(): void {
  if (installed) return
  installed = true

  beforeEach(() => {
    localStorage.clear()
    unexpectedRequests = []
    resetTransportRequests()
    // Tests that exercise transport replace this outright. Anything left on the
    // default is a request the test did not account for, and fails the test.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      unexpectedRequests.push(url)
      throw new Error(`unexpected network request: ${url}`)
    })
  })

  afterEach(() => {
    cleanup()
    clearTestQueryClients()
    // the transport list is reset even when its assertion fails, so one bad
    // case cannot poison the next
    try {
      assertNoUnmatchedRequests()
    } finally {
      resetTransportRequests()
      expect(unexpectedRequests, 'unstubbed network requests').toEqual([])
      vi.unstubAllGlobals()
      localStorage.clear()
    }
  })
}
