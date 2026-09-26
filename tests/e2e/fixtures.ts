import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { test as base } from '@playwright/test'
import { e2eAppCheckDebugToken, e2eEnv } from './env'

const VIEWPORT = { width: 390, height: 844 }

export async function addAppCheckDebugToken(context: BrowserContext): Promise<void> {
  const token = e2eAppCheckDebugToken()
  if (!token) return
  await context.addInitScript((value: string) => {
    ;(self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = value
  }, token)
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await addAppCheckDebugToken(context)
    await use(context)
  },
})

export interface SecondPerson {
  page: Page
  close: () => Promise<void>
}

// A context the test creates itself doesn't get the config's screenshot/video, so record and
// attach them here to match.
export async function openSecondPerson(browser: Browser, testInfo: TestInfo): Promise<SecondPerson> {
  const local = e2eEnv() === 'emulator'
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: local ? { dir: testInfo.outputPath('second-person'), size: VIEWPORT } : undefined,
  })
  await addAppCheckDebugToken(context)
  const page = await context.newPage()

  async function close(): Promise<void> {
    await testInfo.attach('second person', { body: await page.screenshot(), contentType: 'image/png' })
    const video = page.video()
    await context.close()
    if (video) await testInfo.attach('second person video', { path: await video.path(), contentType: 'video/webm' })
  }

  return { page, close }
}

export { expect } from '@playwright/test'
