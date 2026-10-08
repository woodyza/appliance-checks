import { e2eEnv } from './env'
import { expect, test } from './fixtures'
import { signIn, SUPERADMIN_EMAIL } from './signIn'

test.skip(e2eEnv() === 'dev', 'no readable inbox against dev')

test('downloads the brigade QR code PDF', async ({ page }) => {
  await signIn(page, SUPERADMIN_EMAIL)
  await page.goto('/e2etst/admin')

  const downloadPromise = page.waitForEvent('download')
  await page.locator('.download-qr').click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe('E2E Test Brigade QR code.pdf')

  const stream = await download.createReadStream()
  if (!stream) throw new Error('No download stream.')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const pdf = Buffer.concat(chunks).toString('latin1')
  expect(pdf.startsWith('%PDF')).toBe(true)
  expect(pdf).toContain('(E2E Test Brigade Appliance Checks)')
  expect(pdf).toContain(`(${new URL(page.url()).origin}/e2etst)`)
})
