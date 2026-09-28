import { e2eEnv } from './env'
import { expect, test } from './fixtures'
import { signIn, SUPERADMIN_EMAIL } from './signIn'

// Manages its own admin user, but only against the emulator: no readable inbox against `dev`.
test.skip(e2eEnv() === 'dev', 'no readable inbox against dev')

test('adds, edits and removes a VSO admin user', async ({ page }) => {
  const rawEmail = `  E2E-VSO-${String(Date.now())}@Example.com `
  const normalisedEmail = rawEmail.trim().toLowerCase()

  await signIn(page, SUPERADMIN_EMAIL)
  await page.locator('.appliance-card', { hasText: 'User admin' }).click()
  await expect(page).toHaveURL('/admin/users')

  await page.locator('input[type=email]').fill(rawEmail)
  await page.locator('.role-select').selectOption('vso')
  await page.locator('.checkbox-row', { hasText: 'E2E Test Brigade' }).locator('input[type=checkbox]').check()
  await page.getByRole('button', { name: 'Add' }).click()

  const card = page.locator('.appliance-card', { hasText: normalisedEmail })
  await expect(card).toBeVisible()
  await expect(card).toContainText('VSO')
  await expect(card).toContainText('E2E Test Brigade')

  await page.locator('input[type=email]').fill(rawEmail)
  await page.locator('.role-select').selectOption('vso')
  await page.locator('.checkbox-row', { hasText: 'E2E Test Brigade' }).locator('input[type=checkbox]').check()
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.locator('.error-msg')).toHaveText('Already added.')
  await expect(page.locator('.appliance-card', { hasText: normalisedEmail })).toHaveCount(1)

  await card.click()
  await page.locator('input[type=text]').fill('E2E VSO')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(card).toContainText('E2E VSO')

  await card.click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page.locator('.appliance-card', { hasText: normalisedEmail })).toHaveCount(0)
})
