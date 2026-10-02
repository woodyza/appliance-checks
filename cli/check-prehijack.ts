import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { readEnvFile } from './lib/envFile'
import { adminAuth, hostingBaseUrl, readProjectId, resolveTarget } from './lib/target'

// Checks whether a password sign-up made before an admin's first email-link sign-in still works
// afterwards on `dev` (ADR 0005's accepted pre-hijacking risk). Creates a throwaway Auth user for
// --email and always deletes it at the end. Uses one of the day's sign-in emails.

const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1'
const APP_CHECK = 'https://firebaseappcheck.googleapis.com/v1'
const PASSWORD = `prehijack-${String(Date.now())}`

interface DevConfig {
  apiKey: string
  appId: string
  debugToken: string
  siteUrl: string
}

interface AuthResponse {
  localId?: string
  idToken?: string
  error?: { message: string }
}

function devConfig(): DevConfig {
  const env = readEnvFile('.env.dev')
  if (env === null) throw new Error('.env.dev not found: run `make provision ENV=dev` first.')
  const { VITE_FIREBASE_API_KEY: apiKey, VITE_FIREBASE_APP_ID: appId, E2E_APPCHECK_DEBUG_TOKEN: debugToken } = env
  if (!apiKey || !appId || !debugToken) {
    throw new Error('.env.dev needs VITE_FIREBASE_API_KEY, VITE_FIREBASE_APP_ID and E2E_APPCHECK_DEBUG_TOKEN.')
  }
  return { apiKey, appId, debugToken, siteUrl: hostingBaseUrl('dev') }
}

async function authCall(
  config: DevConfig,
  method: 'signUp' | 'signInWithPassword',
  email: string,
  appCheckToken: string | null,
): Promise<AuthResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Referer: `${config.siteUrl}/` }
  if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken
  const response = await fetch(`${IDENTITY_TOOLKIT}/accounts:${method}?key=${config.apiKey}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  })
  return (await response.json()) as AuthResponse
}

// The app id is `1:<project number>:web:<hash>`, and the exchange wants the project number.
async function appCheckToken(config: DevConfig): Promise<string> {
  const projectNumber = config.appId.split(':')[1]
  const response = await fetch(
    `${APP_CHECK}/projects/${projectNumber}/apps/${config.appId}:exchangeDebugToken?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ debugToken: config.debugToken }),
    },
  )
  const body = (await response.json()) as { token?: string; error?: { message: string } }
  if (!body.token) throw new Error(`App Check debug token exchange failed: ${body.error?.message ?? response.status}`)
  return body.token
}

function emailVerifiedClaim(idToken: string): unknown {
  const payload = idToken.split('.')[1] ?? ''
  return (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email_verified?: unknown }).email_verified
}

async function waitForEnter(message: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await rl.question(message)
  } finally {
    rl.close()
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { email: { type: 'string' } } })
  const email = values.email?.trim().toLowerCase()
  if (!email) throw new Error('Usage: npm run cli:check-prehijack -- --email <a spare address you can receive>')

  const config = devConfig()
  // Admin SDK Auth calls made with user (gcloud ADC) credentials need a quota project, unlike
  // Firestore; firebase-admin reads this on every request.
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= readProjectId('dev')
  const db = await resolveTarget('dev')
  const auth = adminAuth()

  if ((await db.collection('adminUsers').doc(email).get()).exists) {
    throw new Error(`${email} is an admin on dev. Use a spare address.`)
  }
  const existing = await auth.getUserByEmail(email).catch((error: unknown) => {
    if ((error as { code?: string }).code === 'auth/user-not-found') return null
    throw error
  })
  if (existing) {
    throw new Error(`${email} already has an Auth account on dev (${existing.uid}). Use another address, or delete it.`)
  }

  let uid: string | undefined
  try {
    console.log('\n1. Password sign-up with the API key alone (no App Check token)')
    const bare = await authCall(config, 'signUp', email, null)
    const bareBlocked = !bare.localId
    console.log(bareBlocked ? `   Rejected: ${bare.error?.message ?? 'unknown error'}` : '   Accepted: App Check is not stopping bare sign-ups.')

    let token: string | null = null
    if (bareBlocked) {
      console.log('\n2. Password sign-up with an App Check token (as a browser on the site would have)')
      token = await appCheckToken(config)
      const signedUp = await authCall(config, 'signUp', email, token)
      if (!signedUp.localId) throw new Error(`Sign-up with App Check failed: ${signedUp.error?.message ?? 'unknown error'}`)
      uid = signedUp.localId
    } else {
      uid = bare.localId
    }
    console.log(`   "Attacker" account: ${uid}`)

    console.log('\n3. The "admin" signs in by email link')
    await waitForEnter(
      `   Open ${config.siteUrl}/admin/sign-in in a browser, request a link for ${email}, open it in the same\n` +
        '   browser (it ends on "Not authorised", which is expected), then press Enter here. ',
    )
    const afterLink = await auth.getUserByEmail(email)
    if (afterLink.uid !== uid) throw new Error(`The link signed in to a different account (${afterLink.uid}); stopping.`)
    if (!afterLink.emailVerified) throw new Error('The account still has an unverified email: the link sign-in did not complete.')
    console.log('   Same account, email now verified.')

    console.log('\n4. The "attacker" signs in with the password again')
    const again = await authCall(config, 'signInWithPassword', email, token)
    console.log('\nResult:')
    if (again.idToken) {
      console.log(`   Password still works (token email_verified: ${String(emailVerifiedClaim(again.idToken))}).`)
      console.log('   Production behaves like the emulator: the pre-hijacking risk in ADR 0005 is real on dev.')
    } else {
      console.log(`   Password rejected: ${again.error?.message ?? 'unknown error'}.`)
      console.log('   Production cleared the password on the email-link sign-in: ADR 0005 overstates the risk.')
    }
    console.log(
      bareBlocked
        ? '   A bare API-key sign-up was blocked by App Check, so an attacker needs a real browser on the site.'
        : '   A bare API-key sign-up got through, so App Check does not raise the bar here.',
    )
  } finally {
    if (uid) {
      await auth.deleteUser(uid)
      console.log(`\nDeleted the test account ${uid}.`)
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
