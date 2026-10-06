import { firstOfPreviousMonth, today } from '../../src/domain/schedule'
import { e2eEnv } from './env'
import { expect, test } from './fixtures'
import { requestSignInLink, signIn, SUPERADMIN_EMAIL } from './signIn'

// There's no inbox a script can read against `dev`, so this suite runs on the emulator only.
test.skip(e2eEnv() === 'dev', 'no readable inbox against dev')

test('downloads a Monthly Report', async ({ page }) => {
  const previousMonth = firstOfPreviousMonth(today()).slice(0, 7)

  await signIn(page, SUPERADMIN_EMAIL)

  await page.locator('.appliance-card', { hasText: 'Brigades' }).click()
  await page.locator('.appliance-card', { hasText: 'E2E Test Brigade' }).click()
  await expect(page).toHaveURL('/e2etst/admin')

  await expect(page.locator('.appliance-select')).toBeVisible()
  await page.locator('.appliance-select').selectOption({ label: 'E2E 3' })
  await page.locator('.month-select').selectOption(previousMonth)

  const downloadPromise = page.waitForEvent('download')
  await page.locator('.download-btn').click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe(`E2E 3-${previousMonth}.pdf`)

  const stream = await download.createReadStream()
  if (!stream) throw new Error('No download stream.')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  expect(Buffer.concat(chunks).subarray(0, 4).toString('utf8')).toBe('%PDF')
})

test('not authorised', async ({ page }) => {
  const otherEmail = `e2e-other-${Date.now()}@example.com`

  await signIn(page, otherEmail)

  await expect(page.locator('.not-authorised')).toContainText('Not authorised')
  await expect(page.locator('.not-authorised')).toContainText(/UID: [A-Za-z0-9]{20,}/)
})

test("reaches an inactive brigade's Brigade Admin page from the brigade list", async ({ page }) => {
  await signIn(page, SUPERADMIN_EMAIL)

  await page.locator('.appliance-card', { hasText: 'Brigades' }).click()
  await page.locator('.appliance-card', { hasText: 'E2E Inactive Brigade (inactive)' }).click()
  await expect(page).toHaveURL('/e2ezzz/admin')
  await expect(page.locator('.appliance-select')).toContainText('E2E Z1')
  await page.locator('.check-entry').click()
  await expect(page).toHaveURL('/e2ezzz')
  await expect(page.locator('.error-msg')).toHaveText('Checks are disabled for this brigade.')
})

test('navigates up from every admin screen, and back in from the landing page', async ({ page }) => {
  await signIn(page, SUPERADMIN_EMAIL)
  await expect(page).toHaveURL('/admin')

  // Each up link is checked by its href as well as where it lands, since history-back would land
  // in the same place on this route through the app.
  await page.locator('.appliance-card', { hasText: 'Users' }).click()
  await page.locator('.new-user').click()
  await expect(page.locator('.header-up')).toHaveAttribute('href', '/admin/users')
  await page.locator('.header-up', { hasText: '‹ Users' }).click()
  await expect(page).toHaveURL('/admin/users')
  await expect(page.locator('.header-up')).toHaveAttribute('href', '/admin')
  await page.locator('.header-up', { hasText: '‹ Admin' }).click()
  await expect(page).toHaveURL('/admin')

  await page.locator('.appliance-card', { hasText: 'Brigades' }).click()
  await page.locator('.new-brigade').click()
  await expect(page.locator('.header-up')).toHaveAttribute('href', '/admin/brigades')
  await page.locator('.header-up', { hasText: '‹ Brigades' }).click()
  await expect(page).toHaveURL('/admin/brigades')

  await page.locator('.appliance-card', { hasText: 'E2E Test Brigade' }).click()
  await expect(page).toHaveURL('/e2etst/admin')
  await expect(page.locator('.header-up')).toHaveAttribute('href', '/admin/brigades')
  await page.locator('.check-entry').click()
  await expect(page).toHaveURL('/e2etst')
  await expect(page.locator('.header-up')).toHaveAttribute('href', '/admin/brigades')
  await page.locator('.header-up', { hasText: '‹ Brigades' }).click()
  await expect(page).toHaveURL('/admin/brigades')
  await expect(page.locator('.header-up')).toHaveAttribute('href', '/admin')
  await page.locator('.header-up', { hasText: '‹ Admin' }).click()
  await expect(page).toHaveURL('/admin')

  await page.goto('/')
  await page.getByRole('link', { name: 'Admin', exact: true }).click()
  await expect(page).toHaveURL('/admin')

  await page.goto('/admin/sign-in')
  await expect(page).toHaveURL('/admin')

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/admin/sign-in')
  await expect(page.locator('input[type=email]')).toBeVisible()
})

test('a sign-in link switches accounts when someone is already signed in', async ({ page }) => {
  const otherEmail = `e2e-switch-${Date.now()}@example.com`

  await signIn(page, SUPERADMIN_EMAIL)
  await expect(page.locator('.appliance-card', { hasText: 'Users' })).toBeVisible()

  // Opened without the request having been made on this device, so it asks for the email.
  await page.goto(await requestSignInLink(otherEmail))
  await expect(page).toHaveURL(/\/admin\/sign-in\?/)
  await page.locator('input[type=email]').fill(otherEmail)
  await page.locator('form button[type=submit]').click()

  await expect(page.locator('.not-authorised')).toContainText('Not authorised')
  await expect(page.locator('.not-authorised')).not.toContainText('emulator-superadmin')
})
