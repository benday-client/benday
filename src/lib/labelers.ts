import { isDid } from '@atproto/api'
import { useSettings } from './store'

interface LabelerConfigurable {
  configureLabelers: (dids: readonly string[]) => void
}

/**
 * Hands the configured labelers to an SDK agent. Live and persisted settings
 * are the untrusted side here, so anything the SDK would reject on the wire is
 * dropped before it can reach the header.
 */
export function applyConfiguredLabelers(agent: LabelerConfigurable): void {
  agent.configureLabelers(useSettings.getState().labelers.filter((did) => isDid(did)))
}
