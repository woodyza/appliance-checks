import { defineConfig } from '@playwright/test'
import { e2eBaseUrl, e2eEnv } from './tests/e2e/env'

const local = e2eEnv() === 'emulator'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: e2eBaseUrl(),
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    // Locally, keep a screenshot and video of every spec in the report to eyeball what ran.
    screenshot: local ? 'on' : 'only-on-failure',
    video: local ? 'on' : 'retain-on-failure',
  },
  webServer:
    local
      ? { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true }
      : undefined,
})
