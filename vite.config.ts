import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    clearMocks: true,
    restoreMocks: true,
    // Native-browser specs need real layout and trusted input; jsdom would
    // measure zeros, so they only run through vitest.browser.config.ts. The
    // scripts/ suite runs under node's own runner via `pnpm test:quality`.
    exclude: [
      ...configDefaults.exclude,
      'src/**/*.browser.test.ts',
      'src/**/*.browser.test.tsx',
      'scripts/**',
    ],
  },
})
