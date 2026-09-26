import { defineConfig } from '@playwright/test'
import { e2eBaseUrl, e2eEnv } from './tests/e2e/env'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: e2eBaseUrl(),
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer:
    e2eEnv() === 'emulator'
      ? { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true }
      : undefined,
})
