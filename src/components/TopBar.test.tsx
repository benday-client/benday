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
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })
    useUiStore.setState({ dialog: null, compose: null })
  })

  it('keeps the account link beside the compose entry', () => {
    renderTopBar()
    expect(screen.getByRole('button', { name: 'compose' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'profile @me.test' })).toBeInTheDocument()
    // the gate owns sign-in now; the bar never offers a second door
    expect(screen.queryByRole('button', { name: 'log in' })).not.toBeInTheDocument()
  })

  it('prints the action word and keeps the key caps for the hold overlay', () => {
    renderTopBar()
    const words: ReadonlyArray<readonly [string, string]> = [
      ['compose', 'compose'],
      ['jump', 'jump'],
      ['search', 'search'],
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
    expect(screen.getAllByText(/^(compose|jump|search|help|settings)$/)).toHaveLength(5)
  })

  it('opens the compose dialog from the signed-in button', () => {
    renderTopBar()
    screen.getByRole('button', { name: 'compose' }).click()
    expect(useUiStore.getState().compose).toMatchObject({ mode: 'post', post: null })
  })
})
