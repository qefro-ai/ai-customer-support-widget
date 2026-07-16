/**
 * Playwright fixtures — drive tests through Obscura over CDP
 * (Obscura replaces headless Chromium; Playwright stays the test runner).
 *
 * @see https://github.com/h4ckf0r0day/obscura#puppeteer--playwright
 */
import { test as base, chromium, expect } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'

const CDP_URL = process.env.OBSCURA_CDP_URL || 'http://127.0.0.1:9222'

type ObscuraFixtures = {
  browser: Browser
  context: BrowserContext
  page: Page
}

export const test = base.extend<ObscuraFixtures>({
  // eslint-disable-next-line no-empty-pattern
  browser: async ({}, use) => {
    const browser = await chromium.connectOverCDP(CDP_URL)
    await use(browser)
    await browser.close()
  },
  context: async ({ browser }, use) => {
    const context = await browser.newContext()
    await use(context)
    await context.close()
  },
  page: async ({ context, baseURL }, use) => {
    const page = await context.newPage()
    if (baseURL) {
      const goto = page.goto.bind(page)
      page.goto = (url, options) => {
        const href =
          typeof url === 'string' && !/^https?:\/\//i.test(url)
            ? new URL(url, baseURL).toString()
            : url
        return goto(href, options)
      }
    }
    await use(page)
    await page.close()
  },
})

export { expect }
