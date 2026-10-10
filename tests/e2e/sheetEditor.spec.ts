import type { Locator, Page } from '@playwright/test'
import { marchFixture } from '../domain/fixtures/sheet'
import { e2eEnv } from './env'
import { expect, test } from './fixtures'
import { signIn, SUPERADMIN_EMAIL } from './signIn'

// Signs in, so emulator only: there's no readable inbox against `dev`.
test.skip(e2eEnv() === 'dev', 'no readable inbox against dev')
test.use({ viewport: { width: 1280, height: 800 } })

const SLUG = 'e2eedt'

async function stubSheets(page: Page): Promise<void> {
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const withData = new URL(route.request().url()).searchParams.has('includeGridData')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(withData ? marchFixture() : { sheets: [{ properties: { title: 'Sheet1' } }] }),
    })
  })
}

function editorSection(page: Page, title: string): Locator {
  return page.locator(`.sheet-section[data-section-title="${title}"]`)
}

function editorRow(section: Locator, label: string): Locator {
  return section.locator(`.sheet-row[data-label="${label}"]`)
}

async function rename(row: Locator, label: string): Promise<void> {
  const input = row.locator('input[data-cell^="label-"]')
  await input.fill(label)
  await input.press('Tab')
}

async function openEditor(page: Page, applianceId: string): Promise<void> {
  await page.goto(`/${SLUG}/admin/${applianceId}`)
  await expect(page.locator('.sheet-section').first()).toBeVisible()
}

async function publish(page: Page): Promise<void> {
  await expect(page.locator('.sheet-row .saving')).toHaveCount(0)
  await page.locator('.publish-btn').click()
  await expect(page.locator('#toast')).toContainText('Published')
  await expect(page.locator('.review-banner')).toHaveCount(0)
}

async function openCheckSection(page: Page, applianceId: string, title: string): Promise<void> {
  await page.goto(`/${SLUG}/${applianceId}`)
  await page.locator('.section-card', { hasText: title }).click()
}

test.beforeEach(async ({ page }) => {
  await stubSheets(page)
  await signIn(page, SUPERADMIN_EMAIL)
  await expect(page).toHaveURL('/admin')
})

test('adds an appliance, imports a sheet and publishes it', async ({ page }) => {
  await page.goto(`/${SLUG}/admin`)
  await page.locator('.add-appliance').click()
  await page.locator('.add-callsign').fill('E2E New 9001')
  await expect(page.locator('.add-id')).toHaveValue('9001')
  await page.locator('.add-save').click()
  await expect(page).toHaveURL(`/${SLUG}/admin/9001`)

  await page.locator('.import-open').click()
  await page.locator('.import-input').fill('https://docs.google.com/spreadsheets/d/fixture123/edit')
  await page.locator('.import-btn').click()
  await expect(page.locator('.review-banner')).toBeVisible()
  await expect(editorSection(page, 'Cab')).toBeVisible()
  await publish(page)

  await page.goto(`/${SLUG}/9001`)
  await expect(page.locator('.section-card', { hasText: 'Cab' })).toBeVisible()
  await expect(page.locator('.section-card', { hasText: 'Documents' })).toBeVisible()

  await page.goto(`/${SLUG}/admin`)
  await page.locator('.add-appliance').click()
  await page.locator('.add-callsign').fill('Duplicate')
  await page.locator('.add-id').fill('e2ed1')
  await page.locator('.add-save').click()
  await expect(page.locator('.id-error')).toHaveText('That id is already used')
})

test('a rename keeps its answer and a deleted Item is gone after Publish', async ({ page }) => {
  await openCheckSection(page, 'e2ed2', 'Cab')
  const torch = page.locator('.item-row', { hasText: 'Torch' })
  await torch.getByRole('button', { name: 'Y', exact: true }).click()
  await expect(torch.locator('.yn-btn.y-active')).toBeVisible()
  await expect(torch.locator('.yn-btn.saving')).toHaveCount(0)

  await openEditor(page, 'e2ed2')
  const cab = editorSection(page, 'Cab')
  await rename(editorRow(cab, 'Torch'), 'Torch (LED)')
  await editorRow(cab, 'Radio').locator('.row-delete').click()
  await expect(page.locator('.banner-summary')).toHaveText('1 removed · 1 renamed')
  await publish(page)

  await openCheckSection(page, 'e2ed2', 'Cab')
  await expect(page.locator('.item-row', { hasText: 'Torch (LED)' }).locator('.yn-btn.y-active')).toBeVisible()
  await expect(page.locator('.item-row', { hasText: 'Radio' })).toHaveCount(0)
})

test('a Complete Check keeps its old Check Sheet after a Publish', async ({ page }) => {
  async function expectAllComplete(): Promise<void> {
    await page.goto(`/${SLUG}/e2ed3`)
    const labels = page.locator('.section-card .progress-label')
    await expect(labels.first()).toBeVisible()
    for (const label of await labels.all()) await expect(label).toHaveText('100%')
  }

  await expectAllComplete()
  await openEditor(page, 'e2ed3')
  await rename(editorRow(editorSection(page, 'Cab'), 'Torch'), 'Torch (renamed)')
  await publish(page)

  await expectAllComplete()
  await page.locator('.section-card', { hasText: 'Cab' }).click()
  await expect(page.locator('.item-row .item-label', { hasText: 'Torch' }).first()).toHaveText('Torch')
})

test('edits survive a reload and Discard reverts them', async ({ page }) => {
  await openEditor(page, 'e2ed4')
  const cab = editorSection(page, 'Cab')
  await rename(editorRow(cab, 'Helmet'), 'Helmet (new)')
  await expect(page.locator('.review-banner')).toBeVisible()
  await expect(page.locator('.sheet-row .saving')).toHaveCount(0)

  await page.reload()
  await expect(editorRow(cab, 'Helmet (new)')).toBeVisible()
  await expect(page.locator('.review-banner')).toBeVisible()

  page.once('dialog', (dialog) => void dialog.accept())
  await page.locator('.discard-btn').click()
  await expect(editorRow(cab, 'Helmet')).toBeVisible()
  await expect(page.locator('.review-banner')).toHaveCount(0)
})

test('a failed Enter shows the saved value and is not sent again on blur', async ({ page }) => {
  let blocking = true
  await page.route(
    (url) => url.pathname.endsWith('/documents:commit'),
    async (route) => {
      if (!blocking) return route.continue()
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': route.request().headers().origin ?? '*',
          'access-control-allow-credentials': 'true',
        },
        body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'blocked by test' } }),
      })
    },
  )
  await openEditor(page, 'e2ed7')
  const cab = editorSection(page, 'Cab')
  const helmet = editorRow(cab, 'Helmet').locator('input[data-cell^="label-"]')

  await helmet.fill('Helmet (new)')
  await helmet.press('Enter')
  await expect(page.locator('#toast')).toContainText("Couldn't save")
  await expect(helmet).toBeFocused()
  await expect(helmet).toHaveValue('Helmet')

  // Edits are queued, so once this one lands any resend from the blur would have landed first.
  blocking = false
  await rename(editorRow(cab, 'Radio'), 'Radio (new)')
  await expect(editorRow(cab, 'Radio (new)')).toBeVisible()
  await expect(page.locator('.sheet-row .saving')).toHaveCount(0)
  await expect(editorRow(cab, 'Helmet')).toBeVisible()
  await expect(editorRow(cab, 'Helmet (new)')).toHaveCount(0)
})

test('drags an Item into another Section', async ({ page }) => {
  await openEditor(page, 'e2ed5')
  const radio = editorRow(editorSection(page, 'Cab'), 'Radio')
  await radio.locator('.drag-handle').dragTo(editorSection(page, 'Road user details').locator('.sheet-row').first())
  await expect(editorRow(editorSection(page, 'Road user details'), 'Radio')).toBeVisible()
  await expect(editorRow(editorSection(page, 'Cab'), 'Radio')).toHaveCount(0)
  await publish(page)

  await openCheckSection(page, 'e2ed5', 'Road user details')
  await expect(page.locator('.item-row', { hasText: 'Radio' })).toBeVisible()
  await page.goto(`/${SLUG}/e2ed5`)
  await page.locator('.section-card', { hasText: 'Cab' }).click()
  await expect(page.locator('.item-row', { hasText: 'Torch' })).toBeVisible()
  await expect(page.locator('.item-row', { hasText: 'Radio' })).toHaveCount(0)
})

test('copies a Check Sheet from another appliance', async ({ page }) => {
  await page.goto(`/${SLUG}/admin`)
  const row = page.locator('.appliance-row', { hasText: 'E2E D6' })
  await expect(row).toContainText('No Check Sheet')
  await expect(row.locator('.row-checks')).toBeDisabled()
  await row.locator('.row-edit').click()
  await expect(page).toHaveURL(`/${SLUG}/admin/e2ed6`)

  await page.locator('.copy-open').click()
  await page.locator('.copy-brigade').selectOption({ label: 'E2E Editor Brigade' })
  await page.locator('.copy-appliance').selectOption({ label: 'E2E D1' })
  await page.locator('.copy-btn').click()
  await expect(page.locator('.review-banner')).toBeVisible()
  await publish(page)

  await page.goto(`/${SLUG}/e2ed6`)
  await expect(page.locator('.section-card', { hasText: 'Cab' })).toBeVisible()
  await expect(page.locator('.section-card', { hasText: 'Road user details' })).toBeVisible()
})

test('deactivating an appliance drops it off the Brigade Link list', async ({ page }) => {
  const listed = page.locator('.appliance-card-name', { hasText: 'E2E D7' })
  const toggle = page.locator('.active-toggle')

  await page.goto(`/${SLUG}/admin/e2ed7`)
  await expect(toggle).toBeChecked()
  page.once('dialog', (dialog) => void dialog.accept())
  await toggle.uncheck()
  await expect(toggle).toBeEnabled()

  await page.goto(`/${SLUG}`)
  await expect(page.locator('.appliance-card-name').first()).toBeVisible()
  await expect(listed).toHaveCount(0)

  await page.goto(`/${SLUG}/admin/e2ed7`)
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  await expect(toggle).toBeEnabled()

  await page.goto(`/${SLUG}`)
  await expect(listed).toBeVisible()
})

test('adds, undoes and reorders, and blocks a Publish with problems', async ({ page }) => {
  await openEditor(page, 'e2ed1')
  const cab = editorSection(page, 'Cab')
  const labels = (): Promise<(string | undefined)[]> => cab.locator('.sheet-row').evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.label))

  await cab.locator('.add-item').click()
  await page.keyboard.type('Brand new')
  await page.keyboard.press('Enter')
  await expect(cab.locator('.sheet-row')).toHaveCount(6)
  await expect(cab.locator('.sheet-row').last().locator('input[data-cell^="label-"]')).toBeFocused()
  await editorRow(cab, 'Brand new').locator('input[data-cell^="label-"]').click()
  await expect.poll(labels).toEqual(['Torch', 'Radio', 'Helmet', 'Fuel', 'Brand new'])

  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(labels).toEqual(['Torch', 'Radio', 'Helmet', 'Brand new', 'Fuel'])

  await editorRow(cab, 'Radio').locator('.row-delete').click()
  await expect(editorRow(cab, 'Radio')).toHaveCount(0)
  await page.locator('.toast-action').click()
  await expect.poll(labels).toEqual(['Torch', 'Radio', 'Helmet', 'Brand new', 'Fuel'])
  await expect(page.locator('.banner-summary')).toHaveText('1 added')

  await page.locator('.add-section').click()
  await page.keyboard.type('Brand section')
  await page.keyboard.press('Enter')
  await expect(editorSection(page, 'Brand section')).toBeVisible()
  await expect(page.locator('.side-section', { hasText: 'Brand section' })).toBeVisible()
  await expect(page.locator('.banner-summary')).toHaveText('2 added')

  await editorRow(cab, 'Brand new').locator('select').selectOption('choice')
  await expect(page.locator('.sheet-row .saving')).toHaveCount(0)
  await page.locator('.publish-btn').click()
  await expect(page.locator('.banner-problems')).toContainText('1 Choice Item needs at least two options')
  await expect(editorRow(cab, 'Brand new')).toHaveClass(/row-problem/)

  page.once('dialog', (dialog) => void dialog.accept())
  await page.locator('.discard-btn').click()
  await expect(page.locator('.review-banner')).toHaveCount(0)
})
