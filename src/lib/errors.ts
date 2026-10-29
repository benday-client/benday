import { XRPCError } from '@atproto/api'

export interface ErrorInfo {
  title: string
  detail: string
  status: number | null
}

function isAbortLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false
  return error.name === 'AbortError' || error.name === 'TimeoutError'
}

export function errorInfo(error: unknown): ErrorInfo {
  if (error instanceof XRPCError) {
    const title = error.error || 'xrpc error'
    return {
      title,
      detail: error.message,
      status: typeof error.status === 'number' ? error.status : null,
    }
  }

  if (isAbortLike(error)) {
    return { title: 'timeout', detail: 'the appview did not answer in time', status: null }
  }

  if (error instanceof Error) {
    return {
      title: 'network error',
      detail: error.message.length > 0 ? error.message : String(error),
      status: null,
    }
  }

  return { title: 'unknown error', detail: String(error), status: null }
}
