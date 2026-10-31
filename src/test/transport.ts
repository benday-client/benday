import { vi } from 'vitest'

export interface RouteRequest {
  url: string
  method: string
  body: string | null
  headers: Record<string, string>
}

export type RouteHandler = (request: RouteRequest) => Response | Promise<Response>

export interface TestTransport {
  calls: RouteRequest[]
  route: (method: string, where: string, handler: RouteHandler) => void
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Installs a recording fetch stub. Routes are keyed by method plus origin and
 * path so a test can prove which host a request actually reached.
 */
export function installTransport(): TestTransport {
  const routes = new Map<string, RouteHandler>()
  const calls: RouteRequest[] = []

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const method = request.method.toUpperCase()
    const body = request.body === null ? null : await request.clone().text()
    const url = new URL(request.url)
    // Lowercased header names exactly as the SDK sent them, so a test can prove
    // which labelers crossed the wire instead of reading back its own argument.
    const headers: Record<string, string> = {}
    request.headers.forEach((value, name) => {
      headers[name] = value
    })
    const call = { url: request.url, method, body, headers }
    calls.push(call)

    const handler = routes.get(`${method} ${url.origin}${url.pathname}`)
    if (handler === undefined) {
      return jsonResponse(404, { error: 'NotFound', message: `no route for ${method} ${call.url}` })
    }
    return handler(call)
  })

  return {
    calls,
    route: (method, where, handler) => {
      routes.set(`${method} ${where}`, handler)
    },
  }
}
