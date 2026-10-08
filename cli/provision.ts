import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { isValidEmail } from '../src/domain/adminUser'
import { assertNoFirebaseToken, firebaseCliAccount, gcloudAccount } from './lib/accounts'
import { billingEnabled } from './lib/billing'
import { readEnvFile, renderEnvFile } from './lib/envFile'
import { type Firebaserc, readFirebaserc, withAlias, writeFirebaserc } from './lib/firebaserc'
import { functionsEnvPath, GMAIL_SECRET_NAME, gmailSecretExists } from './lib/functions'
import { hasRandomSuffix } from './lib/projectId'
import { askText, confirm } from './lib/prompt'
import { capture, run } from './lib/shell'

const DEFAULT_REGION = 'australia-southeast1'
const SERVICES = [
  'firestore.googleapis.com',
  'firebaserules.googleapis.com',
  'firebasehosting.googleapis.com',
  'sheets.googleapis.com',
  'apikeys.googleapis.com',
  'firebaseappcheck.googleapis.com',
  'recaptchaenterprise.googleapis.com',
  'identitytoolkit.googleapis.com',
]
const FUNCTIONS_SERVICES = [
  'cloudfunctions.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'run.googleapis.com',
  'eventarc.googleapis.com',
  'cloudscheduler.googleapis.com',
  'secretmanager.googleapis.com',
]
const SHEETS_KEY_NAME = 'appliance-checks-sheets-cli'
const SHEETS_WEB_KEY_NAME = 'appliance-checks-sheets-web'
const VITE_DEV_ORIGIN = 'http://localhost:5173'
const WEB_APP_NAME = 'appliance-checks-web'
const RECAPTCHA_KEY_NAME = 'appliance-checks-web'
const RECAPTCHA_MIN_SCORE = 0.3
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/

interface HostingSite {
  name: string
  type?: string
  defaultUrl?: string
}

function step(message: string): void {
  console.log(`\n→ ${message}`)
}

function ensureProject(env: string, projectId: string): void {
  step(`Project ${projectId}`)
  const gcpExists = capture('gcloud', ['projects', 'describe', projectId, '--format=value(projectId)']).ok
  if (!gcpExists) {
    run('npx', [
      'firebase', 'projects:create', projectId,
      '--display-name', `Appliance Checks ${env}`,
      '--non-interactive',
    ])
    return
  }

  const listed = capture('npx', ['firebase', 'projects:list', '--json'])
  if (!listed.ok) throw new Error(`Could not list Firebase projects: ${listed.stderr || listed.stdout}`)
  const projects = (JSON.parse(listed.stdout) as { result?: { projectId: string }[] }).result ?? []
  if (projects.some((project) => project.projectId === projectId)) {
    console.log('  already exists with Firebase added')
    return
  }
  run('npx', ['firebase', 'projects:addfirebase', projectId, '--non-interactive'])
}

function ensureServices(projectId: string): void {
  step(`APIs: ${SERVICES.join(', ')}`)
  run('gcloud', ['services', 'enable', ...SERVICES, `--project=${projectId}`])
}

function ensureFirestore(projectId: string, region: string): void {
  step('Firestore (default) database')
  const described = capture('gcloud', [
    'firestore', 'databases', 'describe', '--database=(default)', `--project=${projectId}`,
    '--format=value(locationId)',
  ])
  if (!described.ok) {
    run('gcloud', ['firestore', 'databases', 'create', `--location=${region}`, `--project=${projectId}`])
    return
  }
  console.log(`  already exists in ${described.stdout}`)
  if (described.stdout !== region) {
    console.log(`  warning: requested ${region}, but a database's location can't be changed`)
  }
}

function ensureHosting(projectId: string): void {
  step('Hosting site')
  const listed = capture('npx', ['firebase', 'hosting:sites:list', `--project=${projectId}`, '--json'])
  if (!listed.ok) throw new Error(`Could not list Hosting sites: ${listed.stderr || listed.stdout}`)
  const sites = (JSON.parse(listed.stdout) as { result?: { sites?: HostingSite[] } }).result?.sites ?? []

  const defaultSite = sites.find((site) => site.type === 'DEFAULT_SITE') ?? sites[0]
  if (!defaultSite) {
    run('npx', ['firebase', 'hosting:sites:create', projectId, `--project=${projectId}`, '--non-interactive'])
    return
  }
  const siteId = defaultSite.name.split('/').pop()
  console.log(`  already exists: ${defaultSite.defaultUrl ?? siteId}`)
  if (siteId !== projectId) {
    console.log(`  warning: site id "${siteId}" differs from the project id, so CLI-printed Brigade Links will be wrong`)
  }
}

function apiKeyName(projectId: string, displayName: string): string | null {
  const listed = capture('gcloud', [
    'services', 'api-keys', 'list', `--project=${projectId}`,
    `--filter=displayName="${displayName}"`, '--format=value(displayName,name)',
  ])
  if (!listed.ok) throw new Error(`Could not list API keys: ${listed.stderr}`)
  const names = listed.stdout
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([name]) => name === displayName)
    .map(([, name]) => name)
  if (names.length > 1) {
    throw new Error(`Found ${names.length} API keys named "${displayName}"; delete the extras in the console.`)
  }
  return names[0] ?? null
}

function ensureSheetsKey(projectId: string): string {
  step(`Sheets API key "${SHEETS_KEY_NAME}"`)
  const existing = apiKeyName(projectId, SHEETS_KEY_NAME)
  if (existing) {
    console.log('  already exists')
    return existing
  }
  // Captured and discarded: gcloud prints the new key string on success.
  const creating = capture('gcloud', [
    'services', 'api-keys', 'create', `--project=${projectId}`,
    `--display-name=${SHEETS_KEY_NAME}`, '--api-target=service=sheets.googleapis.com',
  ])
  if (!creating.ok) throw new Error(`Could not create the Sheets API key: ${creating.stderr}`)
  const created = apiKeyName(projectId, SHEETS_KEY_NAME)
  if (!created) throw new Error('Created the Sheets API key but could not find it afterwards.')
  return created
}

// The browser import's key ends up in the bundle, so it's restricted to the Sheets API and to this
// site's origins (plus the Vite dev server on `dev`).
function ensureSheetsWebKey(env: string, projectId: string): string {
  step(`Browser Sheets API key "${SHEETS_WEB_KEY_NAME}"`)
  let keyName = apiKeyName(projectId, SHEETS_WEB_KEY_NAME)
  if (keyName) {
    console.log('  already exists')
  } else {
    const referrers = [`https://${projectId}.web.app/*`, `https://${projectId}.firebaseapp.com/*`]
    if (env === 'dev') referrers.push(`${VITE_DEV_ORIGIN}/*`)
    const creating = capture('gcloud', [
      'services', 'api-keys', 'create', `--project=${projectId}`,
      `--display-name=${SHEETS_WEB_KEY_NAME}`, '--api-target=service=sheets.googleapis.com',
      `--allowed-referrers=${referrers.join(',')}`,
    ])
    if (!creating.ok) throw new Error(`Could not create the browser Sheets API key: ${creating.stderr}`)
    keyName = apiKeyName(projectId, SHEETS_WEB_KEY_NAME)
    if (!keyName) throw new Error('Created the browser Sheets API key but could not find it afterwards.')
  }
  const keyString = capture('gcloud', [
    'services', 'api-keys', 'get-key-string', keyName, `--project=${projectId}`, '--format=value(keyString)',
  ])
  if (!keyString.ok || !keyString.stdout) throw new Error(`Could not read the browser Sheets API key: ${keyString.stderr}`)
  return keyString.stdout
}

interface FirebaseApp {
  appId: string
  displayName?: string
}

function ensureWebApp(projectId: string): string {
  step(`Web app "${WEB_APP_NAME}"`)
  const listed = capture('npx', ['firebase', 'apps:list', 'WEB', '--project', projectId, '--non-interactive', '--json'])
  if (!listed.ok) throw new Error(`Could not list Firebase web apps: ${listed.stderr || listed.stdout}`)
  const apps = (JSON.parse(listed.stdout) as { result?: FirebaseApp[] }).result ?? []
  const existing = apps.find((app) => app.displayName === WEB_APP_NAME)
  if (existing) {
    console.log(`  already exists: ${existing.appId}`)
    return existing.appId
  }

  const created = capture('npx', [
    'firebase', 'apps:create', 'WEB', WEB_APP_NAME,
    '--project', projectId, '--non-interactive', '--json',
  ])
  if (!created.ok) throw new Error(`Could not create the Firebase web app: ${created.stderr || created.stdout}`)
  const appId = (JSON.parse(created.stdout) as { result?: { appId: string } }).result?.appId
  if (!appId) throw new Error('Created the Firebase web app but its app id was missing from the response.')
  return appId
}

interface WebSdkConfig {
  projectId: string
  appId: string
  apiKey: string
  authDomain: string
}

function webConfig(projectId: string, appId: string): WebSdkConfig {
  step('Web app SDK config')
  const result = capture('npx', [
    'firebase', 'apps:sdkconfig', 'WEB', appId,
    '--project', projectId, '--non-interactive', '--json',
  ])
  if (!result.ok) throw new Error(`Could not fetch the web app SDK config: ${result.stderr || result.stdout}`)
  const sdkConfig = (JSON.parse(result.stdout) as { result?: { sdkConfig?: WebSdkConfig } }).result?.sdkConfig
  if (!sdkConfig) throw new Error('Could not find sdkConfig in the apps:sdkconfig output.')
  return sdkConfig
}

interface RecaptchaKey {
  name: string
  displayName?: string
}

function ensureRecaptchaKey(projectId: string): string {
  step(`reCAPTCHA Enterprise key "${RECAPTCHA_KEY_NAME}"`)
  const listed = capture('gcloud', ['recaptcha', 'keys', 'list', `--project=${projectId}`, '--format=json'])
  if (!listed.ok) throw new Error(`Could not list reCAPTCHA Enterprise keys: ${listed.stderr}`)
  const keys = JSON.parse(listed.stdout) as RecaptchaKey[]
  const existing = keys.find((key) => key.displayName === RECAPTCHA_KEY_NAME)
  if (existing) {
    const siteKey = existing.name.split('/').pop()
    if (!siteKey) throw new Error(`Could not parse a site key out of "${existing.name}".`)
    console.log(`  already exists: ${siteKey}`)
    return siteKey
  }

  const domains = `${projectId}.web.app,${projectId}.firebaseapp.com`
  const created = capture('gcloud', [
    'recaptcha', 'keys', 'create',
    `--project=${projectId}`, `--display-name=${RECAPTCHA_KEY_NAME}`,
    '--web', `--domains=${domains}`, '--integration-type=score', '--format=json',
  ])
  if (!created.ok) throw new Error(`Could not create the reCAPTCHA Enterprise key: ${created.stderr}`)
  const name = (JSON.parse(created.stdout) as RecaptchaKey).name
  const siteKey = name.split('/').pop()
  if (!siteKey) throw new Error(`Could not parse a site key out of "${name}".`)
  return siteKey
}

const APP_CHECK_API = 'https://firebaseappcheck.googleapis.com/v1'
const IDENTITY_TOOLKIT_API = 'https://identitytoolkit.googleapis.com'

// The App Check provider/enforcement commands in firebase-tools are behind its `appcheckadmin`
// preview experiment, and no firebase-tools command enables the Auth Email provider, so these
// call the REST APIs directly, as firebase-tools itself does for App Check.
async function restPatch(projectId: string, url: string, body: object, updateMask: string[]): Promise<void> {
  const token = capture('gcloud', ['auth', 'print-access-token'])
  if (!token.ok) throw new Error(`Could not get a gcloud access token: ${token.stderr}`)
  const patchUrl = `${url}?updateMask=${updateMask.join(',')}`
  const response = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token.stdout}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': projectId,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`PATCH ${url} failed (${String(response.status)}): ${await response.text()}`)
}

function projectNumber(projectId: string): string {
  const described = capture('gcloud', ['projects', 'describe', projectId, '--format=value(projectNumber)'])
  if (!described.ok || !described.stdout) throw new Error(`Could not get the project number: ${described.stderr}`)
  return described.stdout
}

async function setAppCheckProvider(projectId: string, number: string, appId: string, siteKey: string): Promise<void> {
  step('App Check provider: reCAPTCHA Enterprise')
  await restPatch(
    projectId,
    `${APP_CHECK_API}/projects/${number}/apps/${appId}/recaptchaEnterpriseConfig`,
    { siteKey, tokenTtl: '3600s', riskAnalysis: { minValidScore: RECAPTCHA_MIN_SCORE } },
    ['siteKey', 'tokenTtl', 'riskAnalysis.minValidScore'],
  )
}

async function enforceFirestore(projectId: string, number: string): Promise<void> {
  step('App Check enforcement: Firestore')
  await restPatch(
    projectId,
    `${APP_CHECK_API}/projects/${number}/services/firestore.googleapis.com`,
    { enforcementMode: 'ENFORCED' },
    ['enforcementMode'],
  )
}

async function enableEmailLinkSignIn(projectId: string): Promise<void> {
  step('Auth Email provider (passwordless)')
  try {
    await restPatch(
      projectId,
      `${IDENTITY_TOOLKIT_API}/admin/v2/projects/${projectId}/config`,
      { signIn: { email: { enabled: true, passwordRequired: false } } },
      ['signIn.email.enabled', 'signIn.email.passwordRequired'],
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('CONFIGURATION_NOT_FOUND')) throw error
    throw new Error(
      `${message}\nAuth hasn't been started on this project: click "Get started" under Authentication in the ` +
        'Firebase console once, then re-run.',
      { cause: error },
    )
  }
}

// Needs the Identity Platform upgrade or billing on some projects (TBC); warn and carry on
// rather than failing the rest of provisioning, and record the outcome in docs/infra-setup.md.
async function enforceAuth(projectId: string, number: string): Promise<void> {
  step('App Check enforcement: Auth')
  try {
    await restPatch(
      projectId,
      `${APP_CHECK_API}/projects/${number}/services/identitytoolkit.googleapis.com`,
      { enforcementMode: 'ENFORCED' },
      ['enforcementMode'],
    )
  } catch (error) {
    console.log(`  warning: could not enforce App Check on Auth: ${error instanceof Error ? error.message : String(error)}`)
    console.log('  continuing without it; see docs/infra-setup.md')
  }
}

function ensureDebugToken(env: string, projectId: string, appId: string): string | null {
  if (env !== 'dev') return null
  step('App Check debug token (dev only, for e2e)')
  const existing = readEnvFile(`.env.${env}`)
  const token = existing?.E2E_APPCHECK_DEBUG_TOKEN ?? randomUUID()
  // --json (captured, not streamed to the terminal) so the token itself never lands in scrollback.
  const created = capture('npx', [
    'firebase', 'appcheck:debugtokens:create', token,
    '--app', appId, '--display-name', 'appliance-checks-e2e', '--force',
    '--project', projectId, '--non-interactive', '--json',
  ])
  if (!created.ok) throw new Error(`Could not create the App Check debug token: ${created.stderr}`)
  console.log('  created (kept out of scrollback; written to .env.dev)')
  return token
}

function writeEnvValues(
  env: string,
  config: WebSdkConfig,
  siteKey: string,
  sheetsWebKey: string,
  debugToken: string | null,
): void {
  step(`.env.${env}`)
  const values: Record<string, string> = {
    VITE_USE_EMULATOR: 'false',
    VITE_FIREBASE_API_KEY: config.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: config.authDomain,
    VITE_FIREBASE_PROJECT_ID: config.projectId,
    VITE_FIREBASE_APP_ID: config.appId,
    VITE_RECAPTCHA_SITE_KEY: siteKey,
    VITE_SHEETS_API_KEY: sheetsWebKey,
  }
  if (debugToken) values.E2E_APPCHECK_DEBUG_TOKEN = debugToken
  const existingSuperadminUid = readEnvFile(`.env.${env}`)?.SUPERADMIN_UID
  if (existingSuperadminUid) values.SUPERADMIN_UID = existingSuperadminUid
  writeFileSync(`.env.${env}`, renderEnvFile(values))
  console.log('  written (it is gitignored)')
}

async function ensureFunctions(env: string, projectId: string, region: string): Promise<void> {
  step('Cloud Functions (weekly VSO email)')
  if (!billingEnabled(projectId)) {
    console.log(`  warning: billing isn't enabled on ${projectId}, so functions can't deploy; skipping (see #23)`)
    return
  }

  console.log(`  APIs: ${FUNCTIONS_SERVICES.join(', ')}`)
  run('gcloud', ['services', 'enable', ...FUNCTIONS_SERVICES, `--project=${projectId}`])

  if (gmailSecretExists(projectId)) {
    console.log(`  secret ${GMAIL_SECRET_NAME} already exists`)
  } else {
    console.log(`  creating secret ${GMAIL_SECRET_NAME}: paste the Gmail app password when prompted`)
    run('npx', ['firebase', 'functions:secrets:set', GMAIL_SECRET_NAME, '--project', projectId])
  }

  const envPath = functionsEnvPath(env)
  const envValues = readEnvFile(envPath) ?? {}
  if (envValues.MAIL_FROM) {
    console.log(`  MAIL_FROM already set in ${envPath}`)
  } else {
    const mailFrom = (await askText('  MAIL_FROM (the Gmail address the email is sent from): ')).toLowerCase()
    if (!isValidEmail(mailFrom)) throw new Error(`"${mailFrom}" is not a valid email address.`)
    writeFileSync(envPath, renderEnvFile({ ...envValues, MAIL_FROM: mailFrom }))
    console.log(`  written to ${envPath} (it is gitignored)`)
  }

  run('npx', ['firebase', 'functions:artifacts:setpolicy', '--location', region, '--force', '--project', projectId])
}

function writeAlias(env: string, updated: Firebaserc | null): void {
  step(`.firebaserc alias "${env}"`)
  if (updated === null) {
    console.log('  already set')
    return
  }
  writeFirebaserc(updated)
  console.log('  written (it is gitignored, keep a note of the ids elsewhere)')
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      env: { type: 'string' },
      'project-id': { type: 'string' },
      region: { type: 'string', default: DEFAULT_REGION },
    },
  })
  const env = values.env
  if (env !== 'dev' && env !== 'prod') throw new Error('--env must be dev or prod.')
  const rc = readFirebaserc() ?? {}
  const projectId = values['project-id'] ?? rc.projects?.[env]
  if (!projectId) throw new Error(`--project-id is required: .firebaserc has no "${env}" alias yet.`)
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('--project-id must be 6–30 lowercase letters, digits or hyphens, starting with a letter.')
  }
  const region = values.region

  assertNoFirebaseToken()
  const gcloud = gcloudAccount()
  const firebase = firebaseCliAccount()
  console.log(`Environment: ${env}`)
  console.log(`Project id:  ${projectId}`)
  console.log(`Region:      ${region}`)
  console.log(`gcloud account:       ${gcloud}`)
  console.log(`Firebase CLI account: ${firebase}`)
  if (env === 'prod' && !hasRandomSuffix(projectId)) {
    console.log('\nWarning: this prod id has no random suffix (e.g. appliance-checks-<6 random letters and digits>), so the site')
    console.log('is easy to guess and find. Project ids are permanent; see docs/infra-setup.md.\n')
  }
  const aliasUpdate = rc.projects?.[env] === projectId ? null : withAlias(rc, env, projectId)
  console.log(`.firebaserc ${env}:     ${aliasUpdate === null ? 'already set' : 'will be written'}`)
  if (gcloud.toLowerCase() !== firebase.toLowerCase()) {
    throw new Error('The gcloud and Firebase CLI accounts differ. Switch one so they match, then re-run.')
  }
  await confirm(`Provision ${env} as ${gcloud}? [y/N] `)

  ensureProject(env, projectId)
  ensureServices(projectId)
  ensureFirestore(projectId, region)
  ensureHosting(projectId)
  const appId = ensureWebApp(projectId)
  const config = webConfig(projectId, appId)
  const siteKey = ensureRecaptchaKey(projectId)
  const number = projectNumber(projectId)
  await setAppCheckProvider(projectId, number, appId, siteKey)
  await enforceFirestore(projectId, number)
  await enableEmailLinkSignIn(projectId)
  await enforceAuth(projectId, number)
  const debugToken = ensureDebugToken(env, projectId, appId)
  const sheetsWebKey = ensureSheetsWebKey(env, projectId)
  writeEnvValues(env, config, siteKey, sheetsWebKey, debugToken)
  const keyName = ensureSheetsKey(projectId)
  await ensureFunctions(env, projectId, region)
  writeAlias(env, aliasUpdate)

  console.log('\nDone. To use the Sheets API key in this shell:')
  console.log(`  export SHEETS_API_KEY=$(gcloud services api-keys get-key-string ${keyName} --format='value(keyString)')`)
  console.log('\nNote: App Check enforcement (Firestore and Auth) can take up to 15 minutes to take effect.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
