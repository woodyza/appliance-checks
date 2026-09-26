import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { GoogleAuth } from 'google-auth-library'
import { readFirebaserc } from './firebaserc'
import { confirm } from './prompt'

export type ProjectTarget = 'dev' | 'prod' | 'emulator'

const EMULATOR_PROJECT_ID = 'demo-appliance-checks'
const DEFAULT_EMULATOR_HOST = '127.0.0.1:8080'

export function parseProjectTarget(value: string | undefined): ProjectTarget {
  if (value === undefined || value === 'emulator') return 'emulator'
  if (value === 'dev' || value === 'prod') return value
  throw new Error(`--project must be one of dev, prod, emulator (got "${value}").`)
}

export function readProjectId(target: 'dev' | 'prod'): string {
  const rc = readFirebaserc()
  if (rc === null) {
    throw new Error(`.firebaserc not found: cannot resolve the "${target}" project alias. See docs/infra-setup.md.`)
  }
  const projectId = rc.projects?.[target]
  if (!projectId) {
    throw new Error(`.firebaserc has no "${target}" project alias. See docs/infra-setup.md.`)
  }
  return projectId
}

async function activeAccountEmail(): Promise<string> {
  const auth = new GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  })
  const client = await auth.getClient()
  const accessToken = await client.getAccessToken()
  if (!accessToken.token) {
    throw new Error('Could not get an access token. Run `gcloud auth application-default login` first.')
  }
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken.token)}`,
  )
  if (!response.ok) {
    throw new Error('Could not look up the active account for the application default credentials.')
  }
  const info = (await response.json()) as { email?: string }
  if (!info.email) {
    throw new Error('Could not determine the active account email from the application default credentials.')
  }
  return info.email
}

export function hostingBaseUrl(target: ProjectTarget): string {
  if (target === 'emulator') return 'http://localhost:5173'
  return `https://${readProjectId(target)}.web.app`
}

export async function resolveTarget(target: ProjectTarget): Promise<Firestore> {
  if (target === 'emulator') {
    process.env.FIRESTORE_EMULATOR_HOST ??= DEFAULT_EMULATOR_HOST
    const app = getApps()[0] ?? initializeApp({ projectId: EMULATOR_PROJECT_ID })
    return getFirestore(app)
  }

  // A leftover FIRESTORE_EMULATOR_HOST from another shell session must not silently redirect a
  // dev/prod run at the emulator instead.
  delete process.env.FIRESTORE_EMULATOR_HOST

  const projectId = readProjectId(target)
  const email = await activeAccountEmail()
  console.log(`Project: ${projectId} (${target})`)
  console.log(`Account: ${email}`)
  await confirm(`Continue against ${target}? [y/N] `)

  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId })
  return getFirestore(app)
}
