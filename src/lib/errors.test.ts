import { XRPCError } from '@atproto/api'
import { describe, expect, it } from 'vitest'
import { errorInfo, normalizeError } from './errors'

function timeoutCause(name: 'AbortError' | 'TimeoutError'): DOMException {
  return new DOMException(`the operation was aborted (${name})`, name)
}

describe('errorInfo', () => {
  it('classifies an SDK-wrapped timeout before the generic xrpc branch', () => {
    const wrapped = XRPCError.from(timeoutCause('TimeoutError'))
    expect(errorInfo(wrapped)).toEqual({
      title: 'timeout',
      detail: 'the appview did not answer in time',
      status: null,
    })

    const aborted = XRPCError.from(timeoutCause('AbortError'))
    expect(errorInfo(aborted).title).toBe('timeout')
  })

  it('classifies a direct abort without the xrpc wrapper', () => {
    expect(errorInfo(timeoutCause('AbortError')).title).toBe('timeout')
    expect(errorInfo(timeoutCause('TimeoutError')).title).toBe('timeout')
  })

  it('calls an ordinary application error an error, not a network condition', () => {
    expect(errorInfo(new Error('thread unavailable'))).toEqual({
      title: 'error',
      detail: 'thread unavailable',
      status: null,
    })
  })

  it('keeps named xrpc classifications and their http status', () => {
    expect(errorInfo(new XRPCError(400, 'InvalidRequest', 'bad input'))).toEqual({
      title: 'invalid request',
      detail: 'bad input',
      status: 400,
    })
    expect(errorInfo(new XRPCError(404, 'NotFound', 'gone'))).toEqual({
      title: 'not found',
      detail: 'gone',
      status: 404,
    })
    expect(errorInfo(new XRPCError(429, 'RateLimitExceeded', 'slow down'))).toEqual({
      title: 'rate limit exceeded',
      detail: 'slow down',
      status: 429,
    })
  })

  it('reads an xrpc error without a code as a network error but keeps the status', () => {
    expect(errorInfo(new XRPCError(500, '', 'upstream failed'))).toEqual({
      title: 'network error',
      detail: 'upstream failed',
      status: 500,
    })
  })

  it('falls back to the unknown title for non-error values', () => {
    expect(errorInfo('boom')).toEqual({ title: 'unknown error', detail: 'boom', status: null })
  })
})

describe('normalizeError', () => {
  it('drops absent errors and wraps values in an Error', () => {
    expect(normalizeError(null)).toBeNull()
    expect(normalizeError(undefined)).toBeNull()
    const wrapped = normalizeError('nope')
    expect(wrapped).toBeInstanceOf(Error)
    expect(wrapped?.message).toBe('nope')
  })
})
