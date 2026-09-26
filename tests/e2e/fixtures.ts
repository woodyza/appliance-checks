import type { BrowserContext } from '@playwright/test'
import { test as base } from '@playwright/test'
import { e2eAppCheckDebugToken } from './env'

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

export { expect } from '@playwright/test'
