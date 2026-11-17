import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { createOAuthClientMetadata } from './src/lib/oauthMetadata'

export default defineConfig(({ mode }) => {
  const { BENDAY_PUBLIC_ORIGIN } = loadEnv(mode, '.', 'BENDAY_')
  // benday ships to one static origin; another deployment passes
  // BENDAY_PUBLIC_ORIGIN and mints its own client metadata instead
  const publicOrigin = BENDAY_PUBLIC_ORIGIN ?? 'https://benday.qex.at'
  const metadata = createOAuthClientMetadata(publicOrigin)
  const oauthMetadata: Plugin = {
    name: 'benday-oauth-metadata',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'oauth-client-metadata.json',
        source: `${JSON.stringify(metadata, null, 2)}\n`,
      })
    },
  }

  return {
    plugins: [react(), oauthMetadata],
    define: {
      'import.meta.env.BENDAY_OAUTH_CLIENT_ID': JSON.stringify(metadata.client_id),
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    preview: {
      host: '127.0.0.1',
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
  }
})
