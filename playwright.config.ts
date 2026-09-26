import { defineConfig } from '@playwright/test'
import { e2eBaseUrl, e2eEnv } from './tests/e2e/env'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: e2eBaseUrl(),
    viewport: { width: 390, height: 844 },
  },
  webServer:
    e2eEnv() === 'emulator'
      ? { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true }
      : undefined,
})
