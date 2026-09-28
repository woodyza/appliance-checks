import { firstOfPreviousMonth, today } from '../../src/domain/schedule'
import { e2eEnv } from './env'
import { expect, test } from './fixtures'
import { signIn, SUPERADMIN_EMAIL } from './signIn'

// There's no inbox a script can read against `dev`, so this suite runs on the emulator only.
test.skip(e2eEnv() === 'dev', 'no readable inbox against dev')

test('downloads a Monthly Report', async ({ page }) => {
  const previousMonth = firstOfPreviousMonth(today()).slice(0, 7)

  await signIn(page, SUPERADMIN_EMAIL)

  await page.locator('.appliance-card', { hasText: 'E2E Test Brigade' }).click()
  await expect(page).toHaveURL('/e2etst')
  await page.locator('.header-back', { hasText: 'Admin' }).click()
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

test("reaches an inactive brigade's Brigade Admin page from the hub", async ({ page }) => {
  await signIn(page, SUPERADMIN_EMAIL)

  await page.locator('.appliance-card', { hasText: 'E2E Inactive Brigade (inactive)' }).click()
  await expect(page).toHaveURL('/e2ezzz')
  await expect(page.locator('.error-msg')).toHaveText('Checks are disabled for this brigade.')
  await page.locator('.header-back', { hasText: 'Admin' }).click()
  await expect(page).toHaveURL('/e2ezzz/admin')
  await expect(page.locator('.appliance-select')).toContainText('E2E Z1')
})
