import { QueryClient } from '@tanstack/react-query'

const clients = new Set<QueryClient>()

/**
 * Tests get a client with retries off so a rejected fetch settles the query at
 * once, and gcTime 0 so background timers never outlive the test.
 */
export function createTestQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  clients.add(client)
  return client
}

export function clearTestQueryClients(): void {
  for (const client of clients) client.clear()
  clients.clear()
}
