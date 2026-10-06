import { e2eEnv } from './env'
import { expect, test } from './fixtures'
import { BRIGADE_ADMIN_EMAIL, signIn, VSO_EMAIL } from './signIn'

// Signs in as users seeded by `e2e-seed` on the emulator only, and there's no inbox to read against dev.
test.skip(e2eEnv() === 'dev', 'no readable inbox against dev')

test('a Brigade Admin starts at their brigade and moves between its pages', async ({ page }) => {
  await signIn(page, BRIGADE_ADMIN_EMAIL)
  await expect(page).toHaveURL('/e2etst/admin')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(page.locator('.header-up')).toHaveCount(0)

  await page.locator('.check-entry').click()
  await expect(page).toHaveURL('/e2etst')
  await expect(page.locator('.header-manage')).toBeVisible()
  await expect(page.locator('.header-up')).toHaveCount(0)

  await page.locator('.header-manage').click()
  await expect(page).toHaveURL('/e2etst/admin')

  await page.goto('/admin')
  await expect(page).toHaveURL('/e2etst/admin')

  await page.goto('/admin/brigades')
  await expect(page).toHaveURL('/e2etst/admin')

  await page.goto('/')
  await page.getByRole('link', { name: 'Admin', exact: true }).click()
  await expect(page).toHaveURL('/e2etst/admin')

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/admin/sign-in')
})

test('a VSO starts at a list of their brigades and has no user admin', async ({ page }) => {
  await signIn(page, VSO_EMAIL)
  await expect(page).toHaveURL('/admin/brigades')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(page.locator('.header-up')).toHaveCount(0)

  const cards = page.locator('.appliance-card')
  await expect(cards).toHaveText(['E2E Inactive Brigade (inactive)', 'E2E Test Brigade'])
  await expect(page.locator('.new-brigade')).toHaveCount(0)

  await cards.filter({ hasText: 'E2E Test Brigade' }).click()
  await expect(page).toHaveURL('/e2etst/admin')
  await expect(page.locator('.header-callsign')).toHaveText('E2E Test Brigade')
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0)

  await page.locator('.check-entry').click()
  await expect(page).toHaveURL('/e2etst')
  await expect(page.locator('.header-up')).toHaveAttribute('href', '/admin/brigades')
  await page.locator('.header-manage').click()
  await page.locator('.header-up', { hasText: '‹ Brigades' }).click()
  await expect(page).toHaveURL('/admin/brigades')

  await page.goto('/admin')
  await expect(page).toHaveURL('/admin/brigades')

  await page.goto('/admin/users')
  await expect(page.locator('.not-authorised')).toContainText('Not authorised')
})

test("a VSO can browse a brigade they aren't assigned to, but not manage it", async ({ page }) => {
  await signIn(page, VSO_EMAIL)
  await expect(page).toHaveURL('/admin/brigades')

  await page.goto('/e2eedt')
  await expect(page.locator('.header-up', { hasText: '‹ Brigades' })).toBeVisible()
  await expect(page.locator('.appliance-card').first()).toBeVisible()
  await expect(page.locator('.header-manage')).toHaveCount(0)

  await page.goto('/e2eedt/admin')
  await expect(page.locator('.not-authorised')).toContainText('Not authorised')
})
