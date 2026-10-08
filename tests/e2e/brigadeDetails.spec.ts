import { e2eEnv } from './env'
import { expect, test } from './fixtures'
import { BRIGADE_ADMIN_EMAIL, signIn, SUPERADMIN_EMAIL, VSO_EMAIL } from './signIn'

// Signs in through the Auth emulator. Created brigades are named "E2E Created …", which
// `e2e-seed` deletes on its next run.
test.skip(e2eEnv() === 'dev', 'no readable inbox against dev')

test('the superadmin creates, edits and deactivates a brigade', async ({ page }) => {
  const name = `E2E Created ${String(Date.now())}`

  await signIn(page, SUPERADMIN_EMAIL)
  await page.locator('.appliance-card', { hasText: 'Brigades' }).click()
  await expect(page).toHaveURL('/admin/brigades')
  await page.locator('.new-brigade').click()
  await expect(page).toHaveURL('/admin/brigades/new')

  await page.locator('.brigade-name').fill(name)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.locator('.error-msg')).toHaveText('Pick a Check Day.')

  await expect(page.locator('.report-email')).toHaveCount(0)
  await page.locator('.check-day-select').selectOption({ label: 'Wednesday' })
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page).toHaveURL(/^http:\/\/localhost:5173\/[2-9a-hjkmnp-z]{6}\/admin$/)
  await expect(page.locator('.header-callsign')).toHaveText(name)
  await expect(page.locator('.check-day-select')).toHaveValue('3')
  await expect(page.locator('.report-email')).toHaveValue('')
  await expect(page.locator('.weekly-email')).toBeChecked()
  await expect(page.locator('.brigade-active')).toBeChecked()

  await page.locator('.brigade-name').fill(`${name} Renamed`)
  await page.locator('.brigade-active').uncheck()
  await page.locator('.save-brigade').click()
  await expect(page.locator('#toast')).toContainText('Saved')

  await page.reload()
  await expect(page.locator('.header-callsign')).toHaveText(`${name} Renamed`)
  await expect(page.locator('.brigade-active')).not.toBeChecked()

  await page.locator('.header-up', { hasText: '‹ Brigades' }).click()
  await expect(page).toHaveURL('/admin/brigades')
  await expect(page.locator('.appliance-card', { hasText: `${name} Renamed (inactive)` })).toBeVisible()
})

test("a Brigade Admin saves their brigade's details and email settings without the weekly email or Active", async ({ page }) => {
  await signIn(page, BRIGADE_ADMIN_EMAIL)
  await expect(page).toHaveURL('/e2etst/admin')

  await expect(page.locator('.brigade-active-readonly')).toHaveText('Active')
  await expect(page.locator('.brigade-active')).toHaveCount(0)
  await expect(page.locator('.report-email')).toHaveCount(0)
  await expect(page.locator('.weekly-email')).toHaveCount(0)

  await page.locator('.save-brigade').click()
  await expect(page.locator('#toast')).toContainText('Saved')

  // Reloaded so the first save's toast can't stand in for the second's.
  await page.reload()
  // Would be refused if the save also wrote the weekly settings, which a Brigade Admin can't.
  await page.locator('.save-reports').click()
  await expect(page.locator('#toast')).toContainText('Saved')

  await page.locator('.appliance-row', { hasText: 'E2E 1' }).locator('.row-checks').click()
  await expect(page).toHaveURL(/^http:\/\/localhost:5173\/e2etst\/e2e1/)
})

test("a VSO sets their brigade's Report Email", async ({ page }) => {
  await signIn(page, VSO_EMAIL)
  await expect(page).toHaveURL('/admin/brigades')
  await page.goto('/e2etst/admin')

  await page.locator('.report-email').fill('e2e-team@example.com')
  await page.locator('.weekly-email').uncheck()
  await page.locator('.save-reports').click()
  await expect(page.locator('#toast')).toContainText('Saved')

  await page.reload()
  await expect(page.locator('.report-email')).toHaveValue('e2e-team@example.com')
  await expect(page.locator('.weekly-email')).not.toBeChecked()
})

test("a Brigade Admin sets their brigade's Monthly Report email", async ({ page }) => {
  await signIn(page, BRIGADE_ADMIN_EMAIL)
  await expect(page).toHaveURL('/e2etst/admin')

  await page.locator('.monthly-report-enabled').check()
  await page.locator('.monthly-report-email').fill('')
  await page.locator('.save-reports').click()
  await expect(page.locator('.error-msg')).toHaveText('Add an address to email the Monthly Reports.')

  await page.locator('.monthly-report-email').fill('  Reports@Example.com ')
  await page.locator('.save-reports').click()
  await expect(page.locator('#toast')).toContainText('Saved')

  await page.reload()
  await expect(page.locator('.monthly-report-enabled')).toBeChecked()
  await expect(page.locator('.monthly-report-email')).toHaveValue('reports@example.com')
})
