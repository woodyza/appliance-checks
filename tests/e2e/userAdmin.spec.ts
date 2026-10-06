import type { Page } from '@playwright/test'
import { e2eEnv } from './env'
import { expect, test } from './fixtures'
import { signIn, SUPERADMIN_EMAIL } from './signIn'

// Manages its own admin user, but only against the emulator: no readable inbox against `dev`.
test.skip(e2eEnv() === 'dev', 'no readable inbox against dev')

async function addVso(page: Page, email: string): Promise<void> {
  await page.locator('.new-user').click()
  await expect(page).toHaveURL('/admin/users/new')
  await page.locator('input[type=email]').fill(email)
  await page.locator('.role-select').selectOption('vso')
  await page.locator('.checkbox-row', { hasText: 'E2E Test Brigade' }).locator('input[type=checkbox]').check()
  await page.getByRole('button', { name: 'Add' }).click()
}

test('adds, edits and removes a VSO admin user', async ({ page }) => {
  const rawEmail = `  E2E-VSO-${String(Date.now())}@Example.com `
  const normalisedEmail = rawEmail.trim().toLowerCase()

  await signIn(page, SUPERADMIN_EMAIL)
  await page.locator('.appliance-card', { hasText: 'Users' }).click()
  await expect(page).toHaveURL('/admin/users')

  await addVso(page, rawEmail)
  await expect(page).toHaveURL('/admin/users')
  const card = page.locator('.appliance-card', { hasText: normalisedEmail })
  await expect(card).toContainText('VSO')
  await expect(card).toContainText('E2E Test Brigade')

  await addVso(page, rawEmail)
  await expect(page.locator('.error-msg')).toHaveText('Already added.')
  await page.locator('.header-up', { hasText: '‹ Users' }).click()
  await expect(page.locator('.appliance-card', { hasText: normalisedEmail })).toHaveCount(1)

  await card.click()
  await expect(page.locator('input[type=email]')).toHaveValue(normalisedEmail)
  await page.locator('input[type=text]').fill('E2E VSO')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL('/admin/users')
  await expect(card).toContainText('E2E VSO')

  await card.click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page).toHaveURL('/admin/users')
  await expect(page.locator('.appliance-card', { hasText: normalisedEmail })).toHaveCount(0)
})
