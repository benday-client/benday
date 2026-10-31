import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useAuthStore } from '../lib/auth'
import { useUiStore } from '../lib/ui'
import { TopBar } from './TopBar'

function renderTopBar() {
  const { hook } = memoryLocation({ path: '/feed', static: true })
  render(
    <Router hook={hook}>
      <TopBar onSearch={() => undefined} />
    </Router>,
  )
}

describe('TopBar compose entry', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
    useUiStore.setState({ dialog: null, compose: null })
  })

  it('offers compose only to a signed-in visitor', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })
    renderTopBar()
    expect(screen.getByRole('button', { name: 'compose' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'log in' })).not.toBeInTheDocument()
  })

  it('hides compose while anonymous and keeps the login door', () => {
    renderTopBar()
    expect(screen.queryByRole('button', { name: 'compose' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'log in' })).toBeInTheDocument()
  })

  it('hides compose while the session is still restoring', () => {
    useAuthStore.setState({ status: 'restoring', account: null, pending: true, error: null })
    renderTopBar()
    expect(screen.queryByRole('button', { name: 'compose' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'log in' })).not.toBeInTheDocument()
  })

  it('prints the action word and keeps the key caps for the hold overlay', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })
    renderTopBar()
    const words: ReadonlyArray<readonly [string, string]> = [
      ['compose', 'compose'],
      ['jump', 'jump'],
      ['search', 'search'],
      ['appview', 'appview'],
      ['keyboard help', 'help'],
      ['settings', 'settings'],
    ]
    for (const [name, word] of words) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveTextContent(word)
      // the chord is not printed on the bar; holding ? paints it over the button
      expect(button.querySelector('.b-kbd')).toBeNull()
    }
    // the word is visible text, not only the accessible name on the title
    expect(screen.getAllByText(/^(compose|jump|search|appview|help|settings)$/)).toHaveLength(6)
  })

  it('opens the compose dialog from the signed-in button', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })
    renderTopBar()
    screen.getByRole('button', { name: 'compose' }).click()
    expect(useUiStore.getState().compose).toMatchObject({ mode: 'post', post: null })
  })
})
