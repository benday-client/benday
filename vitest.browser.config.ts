import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
  },
  test: {
    include: ['src/**/*.browser.test.ts', 'src/**/*.browser.test.tsx'],
    setupFiles: ['./src/test/browserSetup.ts'],
    css: true,
    clearMocks: true,
    restoreMocks: true,
    browser: {
      enabled: true,
      provider: playwright({
        contextOptions: { reducedMotion: 'reduce', deviceScaleFactor: 1 },
      }),
      headless: true,
      ui: false,
      screenshotFailures: false,
      viewport: { width: 1280, height: 800 },
      instances: [{ browser: 'chromium' }],
    },
  },
})
