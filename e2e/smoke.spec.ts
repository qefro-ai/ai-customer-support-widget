import { expect, test } from './fixtures'

test.describe('widget smoke', () => {
  test('launcher mounts on the page', async ({ page }) => {
    await page.goto('/smoke.html')
    const trigger = page.locator('.ai-widget-trigger')
    await expect(trigger).toBeAttached({ timeout: 15_000 })
    await expect(trigger).toHaveAttribute('aria-label', /open chat/i)
  })
})
