import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useAuthStore } from '../lib/auth'
import { bindingFor, displayKeys } from '../lib/keymap'
import { useUiStore } from '../lib/ui'
import { TopBar } from './TopBar'

function renderTopBar(path = '/feed') {
  const { hook } = memoryLocation({ path, static: true })
  return render(
    <Router hook={hook}>
      <TopBar />
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
      ['keyboard help', 'help'],
      ['settings', 'settings'],
    ]
    for (const [name, word] of words) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveTextContent(word)
      // the chord is not printed on the bar; holding ? paints it over the button
      expect(button.querySelector('.b-kbd')).toBeNull()
    }
    // search moved into the tab row, so the right side has four action words
    expect(screen.getAllByText(/^(compose|jump|help|settings)$/)).toHaveLength(4)
  })

  it('opens the compose dialog from the signed-in button', () => {
    renderTopBar()
    screen.getByRole('button', { name: 'compose' }).click()
    expect(useUiStore.getState().compose).toMatchObject({ mode: 'post', post: null })
  })

  it.each([
    { status: 'anonymous', account: null },
    { status: 'restoring', account: { did: 'did:plc:me', handle: 'me.test' } },
    { status: 'authenticated', account: null },
  ] as const)(
    'gates account actions while $status and enables them live after sign-in',
    ({ status, account }) => {
      useAuthStore.setState({ status, account })
      renderTopBar()
      const compose = screen.getByRole('button', { name: 'compose' })
      const jump = screen.getByRole('button', { name: 'jump' })
      expect(compose).toBeDisabled()
      expect(jump).toBeDisabled()
      compose.click()
      jump.click()
      expect(useUiStore.getState()).toMatchObject({ compose: null, dialog: null })

      for (const [name, dialog] of [
        ['keyboard help', 'help'],
        ['settings', 'settings'],
      ] as const) {
        const button = screen.getByRole('button', { name })
        expect(button).toBeEnabled()
        button.click()
        expect(useUiStore.getState().dialog).toBe(dialog)
        useUiStore.getState().closeDialog()
      }

      act(() => {
        useAuthStore.setState({
          status: 'authenticated',
          account: { did: 'did:plc:me', handle: 'me.test' },
          pending: true,
        })
      })
      expect(screen.getByRole('button', { name: 'compose' })).toBe(compose)
      expect(compose).toBeEnabled()
      expect(jump).toBeEnabled()
      compose.click()
      expect(useUiStore.getState().compose).toMatchObject({ mode: 'post', post: null })
      useUiStore.getState().closeCompose()
      jump.click()
      expect(useUiStore.getState().dialog).toBe('palette')
    },
  )
})

describe('TopBar tab row', () => {
  beforeEach(() => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })
    useUiStore.setState({ dialog: null, compose: null })
  })

  it.each(['/feed', '/search'] as const)('orders and marks the primary tabs on %s', (path) => {
    const { container } = renderTopBar(path)
    const nav = container.querySelector('.b-topbar__nav')
    if (nav === null) throw new Error('primary nav missing')
    const tabs = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a.b-topbar__link'))
    expect(tabs.map((tab) => tab.textContent)).toEqual(['feeds', 'search', 'notifications'])
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      '/feed',
      '/search',
      '/notifications',
    ])

    const active = tabs.filter((tab) => tab.getAttribute('data-active') === 'true')
    expect(active).toHaveLength(1)
    expect(active[0]?.getAttribute('aria-current')).toBe('page')
    expect(active[0]?.textContent).toBe(path === '/search' ? 'search' : 'feeds')

    const searchTab = screen.getByRole('link', { name: 'search' })
    const searchKey = displayKeys(bindingFor('search'))[0] ?? ''
    expect(searchTab.getAttribute('data-keyhint')).toBe('search')
    expect(searchTab.getAttribute('title')).toBe(`search · ${searchKey}`)
    expect(searchKey.length).toBeGreaterThan(0)
  })
})
