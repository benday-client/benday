import { isDid } from '@atproto/api'
import { currentAccountLabelers } from './accountLabelers'

interface LabelerConfigurable {
  configureLabelers: (dids: readonly string[]) => void
}

/**
 * Hands the signed-in account's labelers to an SDK agent. The list is sanitized
 * where it is stored, and the wire predicate is applied again here so nothing
 * the SDK would reject reaches the header.
 */
export function applyConfiguredLabelers(agent: LabelerConfigurable): void {
  agent.configureLabelers(currentAccountLabelers().filter((did) => isDid(did)))
}
