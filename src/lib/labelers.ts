import { useSettings } from './store'

interface LabelerConfigurable {
  configureLabelers: (dids: readonly string[]) => void
}

export function applyConfiguredLabelers(agent: LabelerConfigurable): void {
  agent.configureLabelers(useSettings.getState().labelers)
}
