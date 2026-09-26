import { loadEnv } from 'vite'
import { readFirebaserc } from '../../cli/lib/firebaserc'

export type E2eEnv = 'emulator' | 'dev'

export function e2eEnv(): E2eEnv {
  return process.env.E2E_ENV === 'dev' ? 'dev' : 'emulator'
}

export function e2eBaseUrl(): string {
  if (e2eEnv() === 'emulator') return 'http://localhost:5173'
  const rc = readFirebaserc()
  const projectId = rc?.projects?.dev
  if (!projectId) throw new Error('.firebaserc has no "dev" project alias.')
  return `https://${projectId}.web.app`
}

export function e2eAppCheckDebugToken(): string | undefined {
  if (e2eEnv() === 'emulator') return undefined
  const token = loadEnv('dev', process.cwd(), '').E2E_APPCHECK_DEBUG_TOKEN
  if (!token) {
    throw new Error(
      'E2E_APPCHECK_DEBUG_TOKEN is not set in .env.dev. Run `make provision ENV=dev PROJECT_ID=<id>` to register one.',
    )
  }
  return token
}
