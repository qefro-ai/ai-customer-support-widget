import { defineConfig } from '@playwright/test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const obscuraBin = process.env.OBSCURA_BIN || join(root, '.obscura', 'obscura')
const cdpPort = process.env.OBSCURA_CDP_PORT || '9222'

/**
 * Widget smoke — Playwright runner + Obscura as the headless browser (CDP).
 * Install: npm run test:e2e:install
 * Run:     npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'obscura' }],
  webServer: [
    {
      command: `${obscuraBin} serve --port ${cdpPort} --allow-private-network`,
      url: `http://127.0.0.1:${cdpPort}/json/version`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run build && node e2e/static-server.mjs',
      url: 'http://127.0.0.1:4174/smoke.html',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
})
