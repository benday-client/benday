import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/400-italic.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-mono/600-italic.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/layout.css'
import '../styles/components.css'
import '../styles/cards.css'
import '../styles/dialogs.css'
import '../styles/account.css'
import '../styles/views.css'
import '../styles/search.css'
import '../styles/notifications.css'
import '../styles/compose.css'
import '../styles/media.css'
import '../styles/dither.css'
import '../styles/theme-effects.css'
import { afterEach, beforeEach } from 'vitest'
import { page } from 'vitest/browser'
import { useActionStore } from '../lib/actionStore'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import { useUiStore } from '../lib/ui'
import { installTestHygiene } from './hygiene'

installTestHygiene()

const BASE_VIEWPORT = { width: 1280, height: 800 } as const
const KEY_TYPES = new Set(['keydown', 'keyup', 'keypress'])
const CURSOR_PROPERTIES = ['--cursor-default', '--cursor-pointer', '--cursor-text']

interface TrackedListener {
  target: EventTarget
  type: string
  listener: EventListenerOrEventListenerObject
  capture: boolean
}

const trackedListeners: TrackedListener[] = []
const patchedTargets = new WeakSet<EventTarget>()

/**
 * Production code and tests both register window-level key layers. Unmounting
 * removes the ones React owns, but a test that installs its own probe would
 * otherwise leak into the next case, so key listeners are tracked from here and
 * dropped between cases.
 */
function trackKeyListeners(target: EventTarget): void {
  if (patchedTargets.has(target)) return
  patchedTargets.add(target)

  const add = target.addEventListener.bind(target) as EventTarget['addEventListener']
  const remove = target.removeEventListener.bind(target) as EventTarget['removeEventListener']

  target.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (listener !== null && KEY_TYPES.has(type)) {
      trackedListeners.push({
        target,
        type,
        listener,
        capture: typeof options === 'boolean' ? options : options?.capture === true,
      })
    }
    add(type, listener, options)
  }) as EventTarget['addEventListener']

  target.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) => {
    if (listener !== null && KEY_TYPES.has(type)) {
      const capture = typeof options === 'boolean' ? options : options?.capture === true
      const index = trackedListeners.findIndex(
        (tracked) =>
          tracked.target === target &&
          tracked.type === type &&
          tracked.listener === listener &&
          tracked.capture === capture,
      )
      if (index !== -1) trackedListeners.splice(index, 1)
    }
    remove(type, listener, options)
  }) as EventTarget['removeEventListener']
}

function clearTrackedListeners(): void {
  for (const tracked of trackedListeners.splice(0, trackedListeners.length)) {
    tracked.target.removeEventListener(tracked.type, tracked.listener, tracked.capture)
  }
}

function resetRootChrome(): void {
  const root = document.documentElement
  // Same defaults the shipped index.html boots with.
  root.dataset['theme'] = 'void'
  root.dataset['contrast'] = 'normal'
  delete root.dataset['input']
  for (const property of CURSOR_PROPERTIES) root.style.removeProperty(property)
  document.body.removeAttribute('style')
}

function resetStores(): void {
  useSettings.persist.clearStorage()
  useSettings.setState(useSettings.getInitialState(), true)
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useActionStore.setState(useActionStore.getInitialState(), true)
  useUiStore.setState(useUiStore.getInitialState(), true)
}

trackKeyListeners(window)
trackKeyListeners(document)

beforeEach(async () => {
  resetStores()
  resetRootChrome()
  document.getSelection()?.removeAllRanges()
  await page.viewport(BASE_VIEWPORT.width, BASE_VIEWPORT.height)
})

afterEach(() => {
  clearTrackedListeners()
  document.getSelection()?.removeAllRanges()
  resetRootChrome()
})
