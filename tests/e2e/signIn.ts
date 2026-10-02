import type { Page } from '@playwright/test'
import { expect } from './fixtures'

export const AUTH_EMULATOR_HOST = '127.0.0.1:9099'
export const EMULATOR_PROJECT_ID = 'demo-appliance-checks'
export const SUPERADMIN_EMAIL = 'e2e-admin@example.com'

interface OobCode {
  email: string
  oobLink: string
  requestType: string
}

export async function latestSignInLink(email: string): Promise<string> {
  const response = await fetch(`http://${AUTH_EMULATOR_HOST}/emulator/v1/projects/${EMULATOR_PROJECT_ID}/oobCodes`)
  const { oobCodes } = (await response.json()) as { oobCodes: OobCode[] }
  const matching = oobCodes.filter((code) => code.email === email && code.requestType === 'EMAIL_SIGNIN')
  const latest = matching.at(-1)
  if (!latest) throw new Error(`No EMAIL_SIGNIN link found for ${email}.`)
  return latest.oobLink
}

// Requests a link without going through `/admin/sign-in`, which redirects someone already signed in.
export async function requestSignInLink(email: string): Promise<string> {
  await fetch(
    `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: 'EMAIL_SIGNIN',
        email,
        continueUrl: 'http://localhost:5173/admin/sign-in',
        canHandleCodeInApp: true,
      }),
    },
  )
  return latestSignInLink(email)
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/admin/sign-in')
  await page.locator('input[type=email]').fill(email)
  await page.getByRole('button', { name: 'Send sign-in link' }).click()
  await expect(page.locator('.picker-heading')).toHaveText('Check your inbox')

  await page.goto(await latestSignInLink(email))
}
