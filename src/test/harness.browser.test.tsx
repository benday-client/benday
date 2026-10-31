import { expect, it } from 'vitest'
import { renderStage } from '../test/stage'

it('boots a real chromium with the production stylesheet', async () => {
  const { container } = renderStage(<p data-testid="probe">hello</p>)
  const main = container.querySelector('.b-main')
  expect(main).not.toBeNull()
  expect(main?.getBoundingClientRect().height).toBeGreaterThan(0)
  const probe = container.querySelector('[data-testid="probe"]')
  expect(probe).not.toBeNull()
  // the production stylesheet must be applied, not a blank document
  expect(getComputedStyle(document.body).fontFamily).toContain('IBM Plex Mono')
})
