import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

/** A render fault is not always an Error; the boundary must survive each shape. */
function Thrown({ value }: { value: unknown }): ReactNode {
  throw value
}

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error('late fault')
  return <p>still here</p>
}

beforeEach(() => {
  // React reports every caught render error to the console in development; the
  // tests assert the recovery screen instead of the log
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('AppErrorBoundary', () => {
  it('announces and focuses a thrown string', () => {
    render(
      <AppErrorBoundary>
        <Thrown value="boom" />
      </AppErrorBoundary>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('boom')
    expect(alert).toHaveFocus()
  })

  it('renders a throw of null without a second exception', () => {
    render(
      <AppErrorBoundary>
        <Thrown value={null} />
      </AppErrorBoundary>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('null')
    expect(alert).toHaveFocus()
  })

  it('renders a throw of undefined without a second exception', () => {
    render(
      <AppErrorBoundary>
        <Thrown value={undefined} />
      </AppErrorBoundary>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('undefined')
    expect(alert).toHaveFocus()
  })

  it('renders a thrown object as text', () => {
    render(
      <AppErrorBoundary>
        <Thrown value={{ code: 42 }} />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('[object Object]')
  })

  it('takes focus when a live app crashes', () => {
    const view = render(
      <AppErrorBoundary>
        <Boom fail={false} />
      </AppErrorBoundary>,
    )
    expect(screen.getByText('still here')).toBeInTheDocument()

    act(() => {
      view.rerender(
        <AppErrorBoundary>
          <Boom fail />
        </AppErrorBoundary>,
      )
    })

    expect(screen.getByRole('alert')).toHaveFocus()
  })

  it('offers exactly one reload action', () => {
    render(
      <AppErrorBoundary>
        <Thrown value="boom" />
      </AppErrorBoundary>,
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveAccessibleName('reload')
  })
})
