import type { Page } from '@playwright/test'
import { addDays, currentCheckDate, today, weekday } from '../../src/domain/schedule'
import { addAppCheckDebugToken, expect, test } from './fixtures'

const TODAY = today()
const CHECK_DAY = weekday(TODAY)
const CURRENT_DATE = currentCheckDate(TODAY, CHECK_DAY)
// The seed script writes the started-but-incomplete previous Check exactly 7 days before the
// current window's Check (cli/e2e-seed.ts).
const PREVIOUS_DATE = addDays(CURRENT_DATE, -7)

function itemRow(page: Page, label: string): ReturnType<Page['locator']> {
  return page.locator('.item-row', { hasText: label })
}

async function openSection(page: Page, title: string): Promise<void> {
  await page.locator('.section-card', { hasText: title }).click()
}

test('opens the current Check', async ({ page }) => {
  await page.goto('/e2etst/e2e1')

  await expect(page.locator('.header-callsign')).toHaveText('E2E 1')
  await expect(page.locator('.section-card').first()).toBeVisible()
  await expect(page.locator('.week-selector')).toHaveValue(CURRENT_DATE)

  await openSection(page, 'Cab')
  const torchRow = itemRow(page, 'Torch')

  // Mark the Section element so a later check can tell whether it got replaced (rather than
  // patched in place) by the first answer on a Check that doesn't exist yet — exactly the moment
  // its stamped version changes from unknown to known.
  await page.locator('.screen-items').evaluate((el) => el.setAttribute('data-test-marker', 'stable'))

  await torchRow.getByRole('button', { name: 'Y', exact: true }).click()
  await expect(torchRow.locator('.yn-btn.y-active')).toBeVisible()
  await expect(torchRow.locator('.yn-btn.saving')).toHaveCount(0)

  // Same Section element, still marked: a second Item (Fuel, left alone by the other specs) can
  // be answered without the view having been swapped out for a loading screen and back (which
  // would close the keyboard and drop in-flight input).
  await expect(page.locator('.screen-items')).toHaveAttribute('data-test-marker', 'stable')
  await page.locator('.item-select').selectOption('1/2')
  await expect(page.locator('.item-select')).toHaveValue('1/2')
  await expect(page.locator('.item-select.saving')).toHaveCount(0)

  await page.locator('.section-back-btn').click()
  const cabCard = page.locator('.section-card', { hasText: 'Cab' })
  await expect(cabCard.locator('.progress-label')).not.toHaveText('0%')

  await openSection(page, 'Cab')
  // Tapping the active Y again clears it.
  await torchRow.getByRole('button', { name: 'Y', exact: true }).click()
  await expect(torchRow.locator('.yn-btn.y-active')).toHaveCount(0)
  await expect(torchRow.locator('.yn-btn.saving')).toHaveCount(0)

  // Re-answer Y: the reload check below relies on it being set.
  await torchRow.getByRole('button', { name: 'Y', exact: true }).click()
  await expect(torchRow.locator('.yn-btn.y-active')).toBeVisible()
  await expect(torchRow.locator('.yn-btn.saving')).toHaveCount(0)

  // Reload lands back on the same Section (the URL still points at it), so no need to
  // navigate into it again.
  await page.reload()
  await expect(torchRow.locator('.yn-btn.y-active')).toBeVisible()
})

test('saves choice and written Items', async ({ page }) => {
  await page.goto('/e2etst/e2e1')
  await expect(page.locator('.week-selector')).toHaveValue(CURRENT_DATE)

  await openSection(page, 'Cab')
  await page.locator('.item-select').selectOption('1/2')
  await expect(page.locator('.item-select.saving')).toHaveCount(0)
  await page.locator('.section-back-btn').click()

  await openSection(page, 'Road user details')
  const odometer = itemRow(page, 'Odometer').locator('.item-input')
  await odometer.fill('54321')
  await odometer.press('Tab')
  await expect(odometer).not.toHaveClass(/saving/)

  const regoRow = itemRow(page, 'Rego expiry')
  await expect(regoRow.locator('.copy-prev-btn')).toBeVisible()
  await expect(regoRow.locator('.copy-prev-val')).toHaveText('31/12/26')
  await regoRow.locator('.copy-prev-btn').click()
  await expect(regoRow.locator('.item-input')).toHaveValue('31/12/26')
  await expect(regoRow.locator('.item-input')).not.toHaveClass(/saving/)
  await page.locator('.section-back-btn').click()

  await page.reload()
  await openSection(page, 'Cab')
  await expect(page.locator('.item-select')).toHaveValue('1/2')
  await page.locator('.section-back-btn').click()

  await openSection(page, 'Road user details')
  await expect(itemRow(page, 'Odometer').locator('.item-input')).toHaveValue('54321')
  await expect(itemRow(page, 'Rego expiry').locator('.item-input')).toHaveValue('31/12/26')
})

test('answers land on the selected Check', async ({ page }) => {
  await page.goto('/e2etst/e2e2')
  await expect(page.locator('.week-selector')).toHaveValue(PREVIOUS_DATE)
  await expect(page).toHaveURL(new RegExp(`check=${PREVIOUS_DATE}`))

  await page.locator('.week-selector').selectOption(CURRENT_DATE)
  await openSection(page, 'Cab')
  const radioRow = itemRow(page, 'Radio')
  await radioRow.getByRole('button', { name: 'Y', exact: true }).click()
  await expect(radioRow.locator('.yn-btn.y-active')).toBeVisible()
  await expect(radioRow.locator('.yn-btn.saving')).toHaveCount(0)
  await page.locator('.section-back-btn').click()

  await page.reload()
  await expect(page.locator('.week-selector')).toHaveValue(CURRENT_DATE)
  await expect(page).toHaveURL(new RegExp(`check=${CURRENT_DATE}`))
  await openSection(page, 'Cab')
  await expect(radioRow.locator('.yn-btn.y-active')).toBeVisible()
  await page.locator('.section-back-btn').click()

  await page.locator('.week-selector').selectOption(PREVIOUS_DATE)
  await openSection(page, 'Cab')
  await expect(radioRow.locator('.yn-btn.y-active')).not.toBeVisible()
})

test('two people answering different Items both keep their answers', async ({ browser }) => {
  const contextA = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const contextB = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await addAppCheckDebugToken(contextA)
  await addAppCheckDebugToken(contextB)
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    await Promise.all([pageA.goto('/e2etst/e2e1'), pageB.goto('/e2etst/e2e1')])
    await Promise.all([expect(pageA.locator('.week-selector')).toBeVisible(), expect(pageB.locator('.week-selector')).toBeVisible()])
    await Promise.all([openSection(pageA, 'Cab'), openSection(pageB, 'Cab')])

    await Promise.all([
      itemRow(pageA, 'Helmet').getByRole('button', { name: 'N', exact: true }).click(),
      itemRow(pageB, 'Radio').getByRole('button', { name: 'Y', exact: true }).click(),
    ])
    await expect(itemRow(pageA, 'Helmet').locator('.yn-btn.n-active')).toBeVisible()
    await expect(itemRow(pageB, 'Radio').locator('.yn-btn.y-active')).toBeVisible()
    await expect(itemRow(pageA, 'Helmet').locator('.yn-btn.saving')).toHaveCount(0)
    await expect(itemRow(pageB, 'Radio').locator('.yn-btn.saving')).toHaveCount(0)

    // Reload lands back on the same Section (the URL still points at it), so no need to
    // navigate into it again.
    await pageA.reload()
    await pageB.reload()

    await expect(itemRow(pageA, 'Helmet').locator('.yn-btn.n-active')).toBeVisible()
    await expect(itemRow(pageA, 'Radio').locator('.yn-btn.y-active')).toBeVisible()
    await expect(itemRow(pageB, 'Helmet').locator('.yn-btn.n-active')).toBeVisible()
    await expect(itemRow(pageB, 'Radio').locator('.yn-btn.y-active')).toBeVisible()
  } finally {
    await contextA.close()
    await contextB.close()
  }
})

test('switches appliance', async ({ page }) => {
  await page.goto('/e2etst/e2e1')
  await expect(page.locator('.header-callsign')).toHaveText('E2E 1')

  await page.locator('.header-back').click()
  await expect(page.locator('.appliance-card', { hasText: 'E2E 1' })).toBeVisible()
  await expect(page.locator('.appliance-card', { hasText: 'E2E 2' })).toBeVisible()

  await page.locator('.appliance-card', { hasText: 'E2E 2' }).click()
  await expect(page.locator('.header-callsign')).toHaveText('E2E 2')
})
