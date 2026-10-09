export type E2eEnv = 'emulator' | 'dev'

export function e2eEnv(): E2eEnv {
  return process.env.E2E_ENV === 'dev' ? 'dev' : 'emulator'
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set: run \`make e2e ENV=dev\`.`)
  return value
}

export function e2eBaseUrl(): string {
  if (e2eEnv() === 'emulator') return 'http://localhost:5173'
  return requiredEnv('E2E_BASE_URL')
}

export function e2eAppCheckDebugToken(): string | undefined {
  if (e2eEnv() === 'emulator') return undefined
  return requiredEnv('E2E_APPCHECK_DEBUG_TOKEN')
}
